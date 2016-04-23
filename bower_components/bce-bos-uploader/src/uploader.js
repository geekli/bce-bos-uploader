/**
 * Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 *
 * @file uploader.js
 * @author leeight
 */

var sdk = require('bce-sdk-js');
var u = require('underscore');
var async = require('async');
var debug = require('debug')('bce-bos-uploader');

var utils = require('./utils');
var tracker = require('./tracker');

var kDefaultOptions = {
    runtimes: 'html5',

    // bos服务器的地址，默认(http://bos.bj.baidubce.com)
    bos_endpoint: 'http://bos.bj.baidubce.com',

    // 默认的 ak 和 sk 配置
    bos_credentials: null,

    // 如果切换到 appendable 模式，最大只支持 5G 的文件
    // 不再支持 Multipart 的方式上传文件
    bos_appendable: false,

    // 为了处理 Flash 不能发送 HEAD, DELETE 之类的请求，以及无法
    // 获取 response headers 的问题，需要搞一个 relay 服务器，把数据
    // 格式转化一下
    bos_relay_server: 'https://relay.efe.tech',

    // 是否支持多选，默认(false)
    multi_selection: false,

    // 失败之后重试的次数(单个文件或者分片)，默认(0)，不重试
    max_retries: 0,

    // 是否自动上传，默认(false)
    auto_start: false,

    // 最大可以选择的文件大小，默认(100M)
    max_file_size: '100mb',

    // 超过这个文件大小之后，开始使用分片上传，默认(10M)
    bos_multipart_min_size: '10mb',

    // 分片上传的时候，并行上传的个数，默认(1)
    bos_multipart_parallel: 1,

    // 队列中的文件，并行上传的个数，默认(3)
    bos_task_parallel: 3,

    // 计算签名的时候，有些 header 需要剔除，减少传输的体积
    auth_stripped_headers: ['User-Agent', 'Connection'],

    // 分片上传的时候，每个分片的大小，默认(4M)
    chunk_size: '4mb',

    // 分块上传时,是否允许断点续传，默认(true)
    bos_multipart_auto_continue: true,

    // 分开上传的时候，localStorage里面key的生成方式，默认是 `default`
    // 如果需要自定义，可以通过 XXX
    bos_multipart_local_key_generator: 'default',

    // 是否允许选择目录
    dir_selection: false,

    // 是否需要每次都去服务器计算签名
    get_new_uptoken: true,

    // 因为使用 Form Post 的格式，没有设置额外的 Header，从而可以保证
    // 使用 Flash 也能上传大文件
    // 低版本浏览器上传文件的时候，需要设置 policy，默认情况下
    // policy的内容只需要包含 expiration 和 conditions 即可
    // policy: {
    //   expiration: 'xx',
    //   conditions: [
    //     {bucket: 'the-bucket-name'}
    //   ]
    // }
    bos_policy: null,

    // 低版本浏览器上传文件的时候，需要设置 policy_signature
    // 如果没有设置 bos_policy_signature 的话，会通过 uptoken_url 来请求
    // 默认只会请求一次，如果失效了，需要手动来重置 policy_signature
    bos_policy_signature: null,

    // JSONP 默认的超时时间(5000ms)
    uptoken_jsonp_timeout: 5000,

    // 是否要禁用统计，默认不禁用
    // 如果需要禁用，把 tracker_id 设置成 null 即可
    tracker_id: '2e0bc8c5e7ceb25796ba4962e7b57387'
};

var kPostInit = 'PostInit';
var kKey = 'Key';
var kListParts = 'ListParts';

// var kFilesRemoved   = 'FilesRemoved';
var kFileFiltered = 'FileFiltered';
var kFilesAdded = 'FilesAdded';
var kFilesFilter = 'FilesFilter';
var kNetworkSpeed = 'NetworkSpeed';
var kBeforeUpload = 'BeforeUpload';
// var kUploadFile     = 'UploadFile';       // ??
var kUploadProgress = 'UploadProgress';
var kFileUploaded = 'FileUploaded';
var kUploadPartProgress = 'UploadPartProgress';
var kChunkUploaded = 'ChunkUploaded';
var kUploadResume = 'UploadResume'; // 断点续传
// var kUploadPause = 'UploadPause';   // 暂停
var kUploadResumeError = 'UploadResumeError'; // 尝试断点续传失败
var kUploadComplete = 'UploadComplete';
var kError = 'Error';

/**
 * BCE BOS Uploader
 *
 * @constructor
 * @param {Object|string} options 配置参数
 */
function Uploader(options) {
    if (u.isString(options)) {
        // 支持简便的写法，可以从 DOM 里面分析相关的配置.
        options = u.extend({
            browse_button: options,
            auto_start: true
        }, $(options).data());
    }

    var runtimeOptions = {
        bos_policy: utils.getDefaultPolicy(options.bos_bucket)
    };
    this.options = u.extend({}, kDefaultOptions, runtimeOptions, options);
    this.options.max_file_size = utils.parseSize(this.options.max_file_size);
    this.options.bos_multipart_min_size
        = utils.parseSize(this.options.bos_multipart_min_size);
    this.options.chunk_size = this._resetChunkSize(
        utils.parseSize(this.options.chunk_size));

    var credentials = this.options.bos_credentials;
    if (!credentials && this.options.bos_ak && this.options.bos_sk) {
        this.options.bos_credentials = {
            ak: this.options.bos_ak,
            sk: this.options.bos_sk
        };
    }

    /**
     * @type {sdk.BosClient}
     */
    this.client = new sdk.BosClient({
        endpoint: utils.normalizeEndpoint(this.options.bos_endpoint),
        credentials: this.options.bos_credentials,
        sessionToken: this.options.uptoken
    });

    /**
     * 需要等待上传的文件列表，每次上传的时候，从这里面删除
     * 成功或者失败都不会再放回去了
     * @param {Array.<File>}
     */
    this._files = [];

    /**
     * 是否被中断了，比如 this.stop
     * @type {boolean}
     */
    this._abort = false;

    /**
     * 记录从 start 开始已经上传的字节数.
     * @type {number}
     */
    this._loadedBytes = 0;

    /**
     * 记录队列中总文件的大小.
     * @type {number}
     */
    this._totalBytes = 0;

    /**
     * 记录开始上传的时间.
     * @type {number}
     */
    this._startTime = 0;

    /**
     * 是否处于上传的过程中，也就是正在处理 this._files 队列的内容.
     * @type {boolean}
     */
    this._working = false;

    /**
     * 是否支持xhr2
     * @type {boolean}
     */
    this._xhr2Supported = utils.isXhr2Supported();

    this._init();
}

Uploader.prototype._resetChunkSize = function (chunkSize) {
    // TODO
    return chunkSize;
};

Uploader.prototype._getCustomizedSignature = function (uptokenUrl) {
    var options = this.options;
    var timeout = options.uptoken_jsonp_timeout;

    return function (_, httpMethod, path, params, headers) {
        if (/\bed=([\w\.]+)\b/.test(location.search)) {
            headers.Host = RegExp.$1;
        }

        if (u.isArray(options.auth_stripped_headers)) {
            headers = u.omit(headers, options.auth_stripped_headers);
        }

        var deferred = sdk.Q.defer();
        $.ajax({
            url: uptokenUrl,
            jsonp: 'callback',
            dataType: 'jsonp',
            timeout: timeout,
            data: {
                httpMethod: httpMethod,
                path: path,
                // delay: ~~(Math.random() * 10),
                queries: JSON.stringify(params || {}),
                headers: JSON.stringify(headers || {})
            },
            error: function () {
                deferred.reject(new Error('Get authorization timeout (' + timeout + 'ms).'));
            },
            success: function (payload) {
                if (payload.statusCode === 200 && payload.signature) {
                    deferred.resolve(payload.signature, payload.xbceDate);
                }
                else {
                    deferred.reject(new Error('createSignature failed, statusCode = ' + payload.statusCode));
                }
            }
        });
        return deferred.promise;
    };
};

/**
 * 调用 this.options.init 里面配置的方法
 *
 * @param {string} methodName 方法名称
 * @param {Array.<*>} args 调用时候的参数.
 * @param {boolean=} throwErrors 如果发生异常的时候，是否需要抛出来
 * @return {*} 事件的返回值.
 */
Uploader.prototype._invoke = function (methodName, args, throwErrors) {
    var init = this.options.init || this.options.Init;
    if (!init) {
        return;
    }

    var method = init[methodName];
    if (typeof method !== 'function') {
        return;
    }

    try {
        var up = null;
        args = args == null ? [up] : [up].concat(args);
        return method.apply(null, args);
    }
    catch (ex) {
        debug('%s(%j) -> %s', methodName, args, ex);
        if (throwErrors === true) {
            return sdk.Q.reject(ex);
        }
    }
};

/**
 * 初始化控件.
 */
Uploader.prototype._init = function () {
    var options = this.options;
    var accept = options.accept;

    if (options.tracker_id) {
        tracker.init(options.tracker_id);
    }

    var self = this;
    if (!this._xhr2Supported
        && typeof mOxie !== 'undefined'
        && u.isFunction(mOxie.FileInput)) {
        // https://github.com/moxiecode/moxie/wiki/FileInput
        // mOxie.FileInput 只支持
        // [+]: browse_button, accept multiple, directory, file
        // [x]: container, required_caps
        var fileInput = new mOxie.FileInput({
            runtime_order: 'flash,html4',
            browse_button: $(options.browse_button).get(0),
            swf_url: options.flash_swf_url,
            accept: utils.expandAcceptToArray(accept),
            multiple: options.multi_selection,
            directory: options.dir_selection,
            file: 'file'      // PostObject接口要求固定是 'file'
        });

        fileInput.onchange = u.bind(this._onFilesAdded, this);
        fileInput.init();
    }

    var promise = sdk.Q.resolve();
    if (!self._xhr2Supported) {
        if (options.bos_policy && options.bos_credentials) {
            promise = sdk.Q.fcall(function () {
                var credentials = options.bos_credentials;
                var auth = new sdk.Auth(credentials.ak, credentials.sk);
                options.bos_policy_base64 = new Buffer(JSON.stringify(options.bos_policy)).toString('base64');
                options.bos_policy_signature = auth.hash(options.bos_policy_base64, credentials.sk);
                options.bos_ak = credentials.ak;
            });
        }
        else {
            promise = self._initPolicySignature().then(function (payload) {
                if (payload) {
                    options.bos_policy_base64 = payload.policy;
                    options.bos_policy_signature = payload.signature;
                    options.bos_ak = payload.accessKey;
                }
            });
        }
    }

    promise.then(function () {
        if (self._xhr2Supported
            && !options.bos_credentials
            && options.uptoken_url
            && options.get_new_uptoken === false) {
            return self._initStsToken();
        }
    }).then(function (payload) {
        if (payload) {
            // 重新初始化一个 sdk.BosClient
            options.bos_credentials = {
                ak: payload.AccessKeyId,
                sk: payload.SecretAccessKey
            };
            options.uptoken = payload.SessionToken;
            self.client = new sdk.BosClient({
                endpoint: utils.normalizeEndpoint(options.bos_endpoint),
                credentials: options.bos_credentials,
                sessionToken: options.uptoken
            });
        }
    }).then(function () {
        if (options.bos_credentials) {
            self.client.createSignature = function (_, httpMethod, path, params, headers) {
                var credentials = _ || this.config.credentials;
                return sdk.Q.fcall(function () {
                    var auth = new sdk.Auth(credentials.ak, credentials.sk);
                    return auth.generateAuthorization(httpMethod, path, params, headers);
                });
            };
        }
        else if (options.uptoken_url && options.get_new_uptoken === true) {
            // 服务端动态签名的方式
            self.client.createSignature = self._getCustomizedSignature(options.uptoken_url);
        }
        self._initEvents();
        self._invoke(kPostInit);
    }).catch(function (error) {
        debug(error);
        self._invoke(kError, [error]);
    });
};

Uploader.prototype._initPolicySignature = function () {
    var options = this.options;
    var bos_policy = options.bos_policy;
    var bos_policy_signature = options.bos_policy_signature;
    var uptoken_url = options.uptoken_url;
    var timeout = options.uptoken_jsonp_timeout;

    if (!bos_policy) {
        // 如果没有设置 bos_policy，莫非因为 bucket 是 public-read-write?
        // 因为默认情况下 bos_policy 是有内容设置的，所以如果出现不存在的情况
        // 肯定是使用者显式的设置成 null 了
        return sdk.Q.resolve();
    }

    if (!bos_policy_signature) {
        // 如果设置了 bos_policy 但是没有设置 bos_policy_signature
        // 那么就动态的从后台请求一次
        if (!uptoken_url) {
            return sdk.Q.reject(new Error('In order to get policy signature, `uptoken_url` must be setted.'));
        }

        var deferred = sdk.Q.defer();
        $.ajax({
            url: uptoken_url,
            jsonp: 'callback',
            dataType: 'jsonp',
            timeout: timeout,
            data: {
                policy: JSON.stringify(bos_policy)
            },
            success: function (payload) {
                // payload.policy (base64)
                // payload.signature
                // payload.accessKey
                deferred.resolve(payload);
            },
            error: function () {
                deferred.reject(new Error('Get policy signature timeout (' + timeout + 'ms).'));
            }
        });
        return deferred.promise;
    }

    // 不需要用户自己设置，主动计算一下就好了.
    if (options.bos_policy_base64 == null) {
        options.bos_policy_base64 = new Buffer(JSON.stringify(
            bos_policy)).toString('base64');
    }

    return sdk.Q.resolve();
};

Uploader.prototype._initEvents = function () {
    var options = this.options;
    var btn = $(options.browse_button);
    if (btn.attr('multiple') == null) {
        // 如果用户没有显示的设置过 multiple，使用 multi_selection 的设置
        // 否则保留 <input multiple /> 的内容
        btn.attr('multiple', !!options.multi_selection);
    }
    btn.on('change', u.bind(this._onFilesAdded, this));

    var accept = options.accept;
    if (accept != null) {
        btn.attr('accept', utils.expandAccept(accept));
    }

    if (options.dir_selection) {
        btn.attr('directory', true);
        btn.attr('mozdirectory', true);
        btn.attr('webkitdirectory', true);
    }

    this.client.on('progress', u.bind(this._onUploadProgress, this));
    // XXX 必须绑定 error 的处理函数，否则会 throw new Error
    this.client.on('error', u.bind(this._onError, this));

    // $(window).on('online', u.bind(this._handleOnlineStatus, this));
    // $(window).on('offline', u.bind(this._handleOfflineStatus, this));

    if (!this._xhr2Supported) {
        // 如果浏览器不支持 xhr2，那么就切换到 mOxie.XMLHttpRequest
        // 但是因为 mOxie.XMLHttpRequest 无法发送 HEAD 请求，无法获取 Response Headers，
        // 因此 getObjectMetadata实际上无法正常工作，因此我们需要：
        // 1. 让 BOS 新增 REST API，在 GET 的请求的同时，把 x-bce-* 放到 Response Body 返回
        // 2. 临时方案：新增一个 Relay 服务，实现方案 1
        //    GET /bj.bcebos.com/v1/bucket/object?httpMethod=HEAD
        //    Host: relay.efe.tech
        //    Authorization: xxx
        // options.bos_relay_server
        // options.swf_url
        this.client.sendHTTPRequest = u.bind(utils.fixXhr(this.options, true), this.client);

        // 自动修复一些其它 XXXClient 发送请求的接口
        sdk.VodClient.prototype.sendHTTPRequest = utils.fixXhr(this.options);
        sdk.DocClient.Document.prototype.sendHTTPRequest = utils.fixXhr(this.options);
    }
};

Uploader.prototype._initStsToken = function () {
    var uptoken_url = this.options.uptoken_url;
    var bucket = this.options.bos_bucket;
    var timeout = this.options.uptoken_jsonp_timeout;

    var deferred = sdk.Q.defer();
    $.ajax({
        url: uptoken_url,
        jsonp: 'callback',
        dataType: 'jsonp',
        timeout: timeout,
        data: {
            sts: JSON.stringify(utils.getDefaultACL(bucket))
        },
        success: function (payload) {
            // payload.AccessKeyId
            // payload.SecretAccessKey
            // payload.SessionToken
            // payload.Expiration
            deferred.resolve(payload);
        },
        error: function () {
            deferred.reject(new Error('Get sts token timeout (' + timeout + 'ms).'));
        }
    });
    return deferred.promise;
};

Uploader.prototype._filterFiles = function (candidates) {
    var self = this;

    // 如果 maxFileSize === 0 就说明不限制大小
    var maxFileSize = this.options.max_file_size;

    var files = u.filter(candidates, function (file) {
        if (maxFileSize > 0 && file.size > maxFileSize) {
            self._invoke(kFileFiltered, [file]);
            return false;
        }

        // TODO
        // 检查后缀之类的

        return true;
    });

    return this._invoke(kFilesFilter, [files]) || files;
};

Uploader.prototype._onFilesAdded = function (e) {
    var files = e.target.files;
    if (!files) {
        // IE7, IE8 低版本浏览器的处理
        var name = e.target.value.split(/[\/\\]/).pop();
        files = [
            {name: name, size: 0}
        ];
    }
    files = this._filterFiles(files);
    if (u.isArray(files) && files.length) {
        this._invoke(kFilesAdded, [files]);
        this._files.push.apply(this._files, files);
    }

    if (this.options.auto_start) {
        this.start();
    }
};

Uploader.prototype._onError = function (e) {
    debug(e);
};

/**
 * 处理上传进度的回掉函数.
 * 1. 这里要区分文件的上传还是分片的上传，分片的上传是通过 partNumber 和 uploadId 的组合来判断的
 * 2. IE6,7,8,9下面，是不需要考虑的，因为不会触发这个事件，而是直接在 _sendPostRequest 触发 kUploadProgress 了
 * 3. 其它情况下，我们判断一下 Request Body 的类型是否是 Blob，从而避免对于其它类型的请求，触发 kUploadProgress
 *    例如：HEAD，GET，POST(InitMultipart) 的时候，是没必要触发 kUploadProgress 的
 *
 * @param {Object} e  Progress Event 对象.
 * @param {Object} httpContext sendHTTPRequest 的参数
 */
Uploader.prototype._onUploadProgress = function (e, httpContext) {
    var args = httpContext.args;
    var file = args.body;

    if (!utils.isBlob(file)) {
        return;
    }

    var progress = e.lengthComputable
        ? e.loaded / e.total
        : 0;

    this._loadedBytes += (e.loaded - file._previousLoaded);
    this._invoke(kNetworkSpeed, [
        this._loadedBytes,
        utils.now() - this._startTime,
        this._totalBytes - this._loadedBytes
    ]);
    file._previousLoaded = e.loaded;

    var eventType = kUploadProgress;
    if (args.params.partNumber && args.params.uploadId) {
        // IE6,7,8,9下面不会有partNumber和uploadId
        // 此时的 file 是 slice 的结果，可能没有自定义的属性
        // 比如 demo 里面的 __id, __mediaId 之类的
        eventType = kUploadPartProgress;
    }

    this._invoke(eventType, [file, progress, e]);
};

Uploader.prototype.start = function () {
    var self = this;

    if (this._working) {
        return;
    }

    if (this._files.length) {
        this._working = true;
        this._abort = false;
        this._startTime = utils.now();
        this._loadedBytes = 0;
        this._totalBytes = u.reduce(this._files, function (previous, item) {
            return previous + item.size;
        }, 0);

        var taskParallel = this.options.bos_task_parallel;
        async.eachLimit(this._files, taskParallel,
            function (file, callback) {
                file._previousLoaded = 0;
                self._uploadNext(file).fin(function () {
                    callback(null, file);
                });
            },
            function (error) {
                self._working = false;
                self._files.length = 0;
                self._invoke(kUploadComplete);
            });
    }
};

Uploader.prototype.stop = function () {
    this._abort = true;
    this._working = false;
};

/**
 * 如果已经上传完毕了，返回 undefined
 *
 * @return {File|undefined}
 */
Uploader.prototype._getNext = function () {
    return this._files.shift();
};

Uploader.prototype._guessContentType = function (file, opt_ignoreCharset) {
    var contentType = file.type;
    if (true || !contentType) {
        var object = file.name;
        var ext = object.split(/\./g).pop();
        contentType = sdk.MimeType.guess(ext);
    }

    // Firefox在POST的时候，Content-Type 一定会有Charset的，因此
    // 这里不管3721，都加上.
    if (!opt_ignoreCharset && !/charset=/.test(contentType)) {
        contentType += '; charset=UTF-8';
    }

    return contentType;
};

Uploader.prototype._uploadNextViaPostObject = function (file, bucket, object) {
    var self = this;
    var options = this.options;
    var config = this.client.config;
    var url = config.endpoint.replace(/^(https?:\/\/)/, '$1' + bucket + '.');
    var fields = {
        'Content-Type': self._guessContentType(file, true),
        'key': object,
        'policy': options.bos_policy_base64,
        'signature': options.bos_policy_signature,
        'accessKey': options.bos_ak,
        'success-action-status': '201'
    };

    return this._sendPostRequest(url, fields, file)
        .then(function (response) {
            response.body.bucket = bucket;
            response.body.object = object;
            self._invoke(kFileUploaded, [file, response]);
        })
        .catch(function (error) {
            debug(error);
            self._invoke(kError, [error, file]);
        });
};

Uploader.prototype._sendPostRequest = function (url, fields, file) {
    var self = this;
    var deferred = sdk.Q.defer();

    if (typeof mOxie !== 'undefined'
        || !u.isFunction(mOxie.FormData)
        || !u.isFunction(mOxie.XMLHttpRequest)) {
        return sdk.Q.reject(new Error('mOxie is undefined.'));
    }

    var formData = new mOxie.FormData();
    u.each(fields, function (value, name) {
        if (value == null) {
            return;
        }
        formData.append(name, value);
    });
    formData.append('file', file);

    var xhr = new mOxie.XMLHttpRequest();
    xhr.onload = function (e) {
        if (xhr.status >= 200 && xhr.status < 300) {
            deferred.resolve({
                http_headers: {},
                body: {}
            });
        }
        else {
            deferred.reject(new Error('Invalid response statusCode ' + xhr.status));
        }
    };
    xhr.onerror = function (error) {
        deferred.reject(error);
    };
    if (xhr.upload) {
        xhr.upload.onprogress = function (e) {
            var progress = e.loaded / e.total;
            self._loadedBytes += (e.loaded - file._previousLoaded);
            file._previousLoaded = e.loaded;
            self._invoke(kNetworkSpeed, [
                self._loadedBytes,
                utils.now() - self._startTime,
                self._totalBytes - self._loadedBytes
            ]);
            self._invoke(kUploadProgress, [file, progress, null]);
        };
    }
    xhr.open('POST', url, true);
    xhr.send(formData, {
        runtime_order: 'flash',
        swf_url: self.options.flash_swf_url
    });

    return deferred.promise;
};


Uploader.prototype._uploadNextViaMultipart = function (file, bucket, object) {
    var contentType = this._guessContentType(file);
    var options = {
        'Content-Type': contentType
    };

    var self = this;
    var uploadId = null;
    var multipartParallel = this.options.bos_multipart_parallel;
    var chunkSize = this.options.chunk_size;

    return this._initiateMultipartUpload(file, chunkSize, bucket, object, options)
        .then(function (response) {
            uploadId = response.body.uploadId;
            var parts = response.body.parts || [];
            // 准备 uploadParts
            var deferred = sdk.Q.defer();
            var tasks = utils.getTasks(file, uploadId, chunkSize, bucket, object);
            utils.filterTasks(tasks, parts);

            var loaded = parts.length;
            // 这个用来记录整体 Parts 的上传进度，不是单个 Part 的上传进度
            // 单个 Part 的上传进度可以监听 kUploadPartProgress 来得到
            var state = {
                lengthComputable: true,
                loaded: loaded,
                total: tasks.length
            };
            if (loaded) {
                self._invoke(kUploadProgress, [file, loaded / tasks.length, null]);
            }

            async.mapLimit(tasks, multipartParallel, self._uploadPart(state),
                function (err, results) {
                    if (err) {
                        deferred.reject(err);
                    }
                    else {
                        deferred.resolve(results);
                    }
                });

            return deferred.promise;
        })
        .then(function (responses) {
            // 因为mOxie的限制，无法获取 Response Headers 的 ETag，因此
            // 这里调用一下 listParts 的接口
            if (!self._xhr2Supported) {
                // 如果分片超过了1000个，实际上是存在问题的
                return self._listAllParts(bucket, object, uploadId)
                    .then(function (payload) {
                        var parts = payload.body.parts;
                        var eTagMap = {};
                        for (var i = 0; i < parts.length; i++) {
                            var part = parts[i];
                            var partNumber = part.partNumber;
                            var eTag = part.eTag;
                            eTagMap[partNumber] = eTag;
                        }
                        for (i = 0; i < responses.length; i++) {
                            var item = responses[i];
                            eTag = eTagMap['' + (i + 1)];
                            if (eTag) {
                                item.http_headers.etag = eTag;
                            }
                        }
                        return responses;
                    });
            }
            return responses;
        })
        .then(function (responses) {
            var partList = [];
            u.each(responses, function (response, index) {
                partList.push({
                    partNumber: index + 1,
                    eTag: response.http_headers.etag
                });
            });
            // 全部上传结束后删除localStorage
            self._generateLocalKey({
                blob: file,
                chunkSize: chunkSize,
                bucket: bucket,
                object: object
            }).then(function (key) {
                utils.removeUploadId(key);
            });
            return self.client.completeMultipartUpload(bucket, object, uploadId, partList);
        })
        .then(function (response) {
            self._invoke(kUploadProgress, [file, 1]);

            response.body.bucket = bucket;
            response.body.object = object;

            self._invoke(kFileUploaded, [file, response]);
        })
        .catch(function (error) {
            self._invoke(kError, [error, file]);
        });
};

Uploader.prototype._generateLocalKey = function (options) {
    var generator = this.options.bos_multipart_local_key_generator;
    return utils.generateLocalKey(options, generator);
};

Uploader.prototype._initiateMultipartUpload = function (file, chunkSize, bucket, object, options) {
    var self = this;
    var uploadId;
    var localSaveKey;

    function initNewMultipartUpload() {
        return self.client.initiateMultipartUpload(bucket, object, options)
            .then(function (response) {
                if (localSaveKey) {
                    utils.setUploadId(localSaveKey, response.body.uploadId);
                }

                response.body.parts = [];
                return response;
            });
    }

    var keyOptions = {
        blob: file,
        chunkSize: chunkSize,
        bucket: bucket,
        object: object
    };
    var promise = this.options.bos_multipart_auto_continue
        ? this._generateLocalKey(keyOptions)
        : sdk.Q.resolve(null);

    return promise.then(function (key) {
            localSaveKey = key;
            if (!localSaveKey) {
                return initNewMultipartUpload();
            }

            uploadId = utils.getUploadId(localSaveKey);
            if (!uploadId) {
                return initNewMultipartUpload();
            }

            return self._listParts(file, bucket, object, uploadId);
        })
        .then(function (response) {
            if (uploadId && localSaveKey) {
                var parts = response.body.parts;
                // listParts 的返回结果
                self._invoke(kUploadResume, [file, parts, null]);
                response.body.uploadId = uploadId;
            }
            return response;
        })
        .catch(function (error) {
            if (uploadId && localSaveKey) {
                // 如果获取已上传分片失败，则重新上传。
                self._invoke(kUploadResumeError, [file, error, null]);
                utils.removeUploadId(localSaveKey);
                return initNewMultipartUpload();
            }
            throw error;
        });
};

Uploader.prototype._listParts = function (file, bucket, object, uploadId) {
    var self = this;
    var localParts = this._invoke(kListParts, [file, uploadId]);

    return sdk.Q.resolve(localParts)
        .then(function (parts) {
            if (u.isArray(parts) && parts.length) {
                return {
                    http_headers: {},
                    body: {
                        parts: parts
                    }
                };
            }

            // 如果返回的不是数组，就调用 listParts 接口从服务器获取数据
            return self._listAllParts(bucket, object, uploadId);
        });
};

Uploader.prototype._listAllParts = function (bucket, object, uploadId) {
    // isTruncated === true / false
    var self = this;
    var deferred = sdk.Q.defer();

    var parts = [];
    var payload = null;
    var maxParts = 1000;          // 每次的分页
    var partNumberMarker = 0;     // 分隔符

    function listParts() {
        var options = {
            maxParts: maxParts,
            partNumberMarker: partNumberMarker
        };
        self.client.listParts(bucket, object, uploadId, options)
            .then(function (response) {
                if (payload == null) {
                    payload = response;
                }

                parts.push.apply(parts, response.body.parts);
                partNumberMarker = response.body.nextPartNumberMarker;

                if (response.body.isTruncated === false) {
                    // 结束了
                    payload.body.parts = parts;
                    deferred.resolve(payload);
                }
                else {
                    // 递归调用
                    listParts();
                }
            })
            .catch(function (error) {
                deferred.reject(error);
            });
    }
    listParts();

    return deferred.promise;
};

Uploader.prototype._uploadPart = function (state) {
    var self = this;

    function uploadPartInner(item, opt_maxRetries) {
        if (item.etag) {
            // 跳过已上传的part
            return sdk.Q.resolve({
                http_headers: {
                    etag: item.etag
                },
                body: {}
            });
        }
        var maxRetries = opt_maxRetries == null
            ? self.options.max_retries
            : opt_maxRetries;

        var blob = item.file.slice(item.start, item.stop + 1);
        blob._previousLoaded = 0;
        return self.client.uploadPartFromBlob(item.bucket, item.object, item.uploadId,
            item.partNumber, item.partSize, blob)
            .then(function (response) {
                ++state.loaded;
                var progress = state.loaded / state.total;
                self._invoke(kUploadProgress, [item.file, progress, null]);

                var result = {
                    uploadId: item.uploadId,
                    partNumber: item.partNumber,
                    partSize: item.partSize,
                    bucket: item.bucket,
                    object: item.object,
                    offset: item.start,
                    total: blob.size,
                    response: response
                };
                self._invoke(kChunkUploaded, [item.file, result]);

                return response;
            })
            .catch(function (error) {
                if (maxRetries > 0) {
                    // 还有重试的机会
                    return uploadPartInner(item, maxRetries - 1);
                }
                // 没有机会重试了 :-(
                throw error;
            });

    }

    return function (item, callback) {
        // file: file,
        // uploadId: uploadId,
        // bucket: bucket,
        // object: object,
        // partNumber: partNumber,
        // partSize: partSize,
        // start: offset,
        // stop: offset + partSize - 1

        var resolve = function (response) {
            callback(null, response);
        };
        var reject = function (error) {
            callback(error);
        };

        uploadPartInner(item).then(resolve, reject);
    };
};

Uploader.prototype._uploadNext = function (file) {
    if (this._abort) {
        this._working = false;
        return sdk.Q.resolve();
    }

    var returnValue = this._invoke(kBeforeUpload, [file]);
    if (returnValue === false) {
        return sdk.Q.resolve();
    }

    var self = this;
    var options = this.options;
    var bucket = options.bos_bucket;
    var object = file.name;
    var throwErrors = true;

    return sdk.Q.resolve(this._invoke(kKey, [file], throwErrors))
        .then(function (result) {
            if (u.isString(result)) {
                object = result;
            }
            else if (u.isObject(result)) {
                bucket = result.bucket || bucket;
                object = result.key || object;
            }

            if (!self._xhr2Supported) {
                return self._uploadNextViaPostObject(file, bucket, object);
            }

            if (options.bos_appendable === true) {
                return self._uploadNextViaAppendObject(file, bucket, object);
            }

            var multipartMinSize = options.bos_multipart_min_size;
            if (file.size > multipartMinSize) {
                return self._uploadNextViaMultipart(file, bucket, object);
            }

            return self._uploadNextViaPutObject(file, bucket, object);
        });
};

Uploader.prototype._getObjectMetadata = function (bucket, object) {
    return this.client.getObjectMetadata(bucket, object)
        .catch(function (error) {
            if (error.status_code === 404) {
                // 文件不存在，可以上传一个新的了
                return {
                    http_headers: {
                        'content-length': 0,
                        'x-bce-next-append-offset': 0,
                        'x-bce-object-type': 'Appendable'
                    },
                    body: {}
                };
            }

            throw error;
        });
};

Uploader.prototype._uploadNextViaAppendObject = function (file, bucket, object) {
    // 调用 getObjectMeta 接口获取 x-bce-next-append-offset 和 x-bce-object-type
    // 如果 x-bce-object-type 不是 "Appendable"，那么就不支持断点续传了
    var self = this;
    var options = this.options;
    var contentType = this._guessContentType(file);

    return this._getObjectMetadata(bucket, object)
        .then(function (response) {
            var httpHeaders = response.http_headers;
            var appendable = utils.isAppendable(httpHeaders);
            if (!appendable) {
                // Normal Object 不能切换为 Appendable Object
                self._invoke(kUploadProgress, [file, 1, null]);
                return sdk.Q.resolve();
            }

            var contentLength = +(httpHeaders['content-length']);
            if (contentLength >= file.size) {
                // 服务端的文件不小于本地，就没必要上传了
                self._invoke(kUploadProgress, [file, 1, null]);
                return sdk.Q.resolve();
            }

            // offset 和 content-length 应该是一样大小的吧？
            var offset = +httpHeaders['x-bce-next-append-offset'];

            // 上传进度
            var progress = file.size <= 0 ? 0 : offset / file.size;
            self._invoke(kUploadProgress, [file, progress, null]);

            // 排除了 offset 之后，按照 chunk_size 切分文件
            // XXX 一般来说，如果启用了 (bos_appendable)，就可以考虑把 chunk_size 设置为一个比较小的值
            var chunkSize = options.chunk_size;
            var tasks = utils.getAppendableTasks(file.size, offset, chunkSize);

            var deferred = sdk.Q.defer();
            async.mapLimit(tasks, 1,
                function (item, callback) {
                    var offset = item.start;
                    var offsetArgument = offset > 0 ? offset : null;
                    var blob = file.slice(offset, item.stop + 1);
                    var resolve = function (response) {
                        var progress = (item.stop + 1) / file.size;
                        self._invoke(kUploadProgress, [file, progress, null]);
                        callback(null, response);
                    };
                    var reject = function (error) {
                        callback(error);
                    };
                    var options = {
                        'Content-Type': contentType,
                        'Content-Length': item.partSize
                    };
                    self.client.appendObjectFromBlob(bucket, object,
                        blob, offsetArgument, options).then(resolve, reject);
                },
                function (err, results) {
                    if (err) {
                        deferred.reject(err);
                    }
                    else {
                        deferred.resolve(results);
                    }
                });
            return deferred.promise;
        })
        .then(function () {
            var response = {
                http_headers: {},
                body: {
                    bucket: bucket,
                    object: object
                }
            };
            self._invoke(kFileUploaded, [file, response]);
        })
        .catch(function (error) {
            self._invoke(kError, [error, file]);
            return sdk.Q.resolve();
        });
};

Uploader.prototype._uploadNextViaPutObject = function (file, bucket, object, opt_maxRetries) {
    var contentType = this._guessContentType(file);
    var options = {
        'Content-Type': contentType
    };

    var self = this;
    var maxRetries = opt_maxRetries == null
        ? this.options.max_retries
        : opt_maxRetries;

    return this.client.putObjectFromBlob(bucket, object, file, options)
        .then(function (response) {
            self._invoke(kUploadProgress, [file, 1]);

            response.body.bucket = bucket;
            response.body.object = object;
            self._invoke(kFileUploaded, [file, response]);
        })
        .catch(function (error) {
            self._invoke(kError, [error, file]);
            if (error.status_code && error.code && error.request_id) {
                // 应该是正常的错误(比如签名异常)，这种情况就不要重试了
                return sdk.Q.resolve();
            }
            // else if (error.status_code === 0) {
            //    // 可能是断网了，safari 触发 online/offline 延迟比较久
            //    // 我们推迟一下 self._uploadNext() 的时机
            //    self.pause();
            //    return;
            // }
            else if (maxRetries > 0) {
                // 还有几乎重试
                return self._uploadNextViaPutObject(file, bucket, object, maxRetries - 1);
            }

            // 重试结束了，不管了，继续下一个文件的上传
            return sdk.Q.resolve();
        });
};

module.exports = Uploader;
