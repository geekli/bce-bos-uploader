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

var kDefaultOptions = {
    runtimes: 'html5',

    // bos服务器的地址，默认（http://bos.bj.baidubce.com）
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

    // 是否支持多选，默认（false）
    multi_selection: false,

    // 失败之后重试的次数（单个文件或者分片），默认（0），不重试
    max_retries: 0,

    // 是否自动上传，默认（false）
    auto_start: false,

    // 最大可以选择的文件大小，默认（100M）
    max_file_size: '100mb',

    // 超过这个文件大小之后，开始使用分片上传，默认（10M）
    bos_multipart_min_size: '10mb',

    // 分片上传的时候，并行上传的个数，默认（1）
    bos_multipart_parallel: 1,

    // 计算签名的时候，有些 header 需要剔除，减少传输的体积
    auth_stripped_headers: ['User-Agent', 'Connection'],

    // 分片上传的时候，每个分片的大小，默认（4M）
    chunk_size: '4mb',

    // 分块上传时,是否允许断点续传，默认（true）
    bos_multipart_auto_continue: true,

    // 分开上传的时候，localStorage里面key的生成方式，默认是 `default`
    // 如果需要自定义，可以通过 XXX
    bos_multipart_local_key_generator: 'default',

    // 是否允许选择目录
    dir_selection: false,

    // 是否需要每次都去服务器计算签名
    get_new_uptoken: true,

    bos_token_mode: null,

    // JSONP 默认的超时时间(5000ms)
    uptoken_jsonp_timeout: 5000
};

var kPostInit = 'PostInit';
var kKey = 'Key';
var kListParts = 'ListParts';

// var kFilesRemoved   = 'FilesRemoved';
var kFileFiltered = 'FileFiltered';
var kFilesAdded = 'FilesAdded';
var kFilesFilter = 'FilesFilter';

var kBeforeUpload = 'BeforeUpload';
// var kUploadFile     = 'UploadFile';       // ??
var kUploadProgress = 'UploadProgress';
var kFileUploaded = 'FileUploaded';
var kUploadPartProgress = 'UploadPartProgress';
var kChunkUploaded = 'ChunkUploaded';
var kUploadResume = 'UploadResume'; // 断点续传
var kUploadResumeError = 'UploadResumeError'; // 尝试断点续传失败

var kError = 'Error';
var kUploadComplete = 'UploadComplete';

// 预先定义几种签名的策略
var TokenMode = {
    DEFAULT: 'default',
    STS: 'sts'
};

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

    var runtimeOptions = {};
    this.options = u.extend({}, kDefaultOptions, runtimeOptions, options);
    this.options.max_file_size = utils.parseSize(this.options.max_file_size);
    this.options.bos_multipart_min_size
        = utils.parseSize(this.options.bos_multipart_min_size);
    this.options.chunk_size = this._resetChunkSize(
        utils.parseSize(this.options.chunk_size));

    if (!this.options.bos_token_mode) {
        this.options.bos_token_mode = this._guessTokenMode();
    }

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
     * FIXME(leeight) 当前正在上传的文件.
     * @type {File}
     */
    this._currentFile = null;

    /**
     * 是否被中断了，比如 this.stop
     * @type {boolean}
     */
    this._abort = false;

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
                params: JSON.stringify(params || {}),
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

    var self = this;
    if (!this._xhr2Supported
        && !u.isUndefined(mOxie)
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

    if (options.bos_token_mode === TokenMode.STS) {
        // 切换到了 STS 的模式
        this._initStsToken()
            .then(function (payload) {
                if (payload) {
                    // 重新初始化一个 sdk.BosClient
                    self.client = new sdk.BosClient({
                        endpoint: utils.normalizeEndpoint(options.bos_endpoint),
                        credentials: {
                            ak: payload.AccessKeyId,
                            sk: payload.SecretAccessKey
                        },
                        sessionToken: payload.SessionToken
                    });
                    self.client.createSignature = function (_, httpMethod, path, params, headers) {
                        var credentials = _ || this.config.credentials;
                        return sdk.Q.fcall(function () {
                            var auth = new sdk.Auth(credentials.ak, credentials.sk);
                            return auth.generateAuthorization(httpMethod, path, params, headers);
                        });
                    };
                }
                self._initEvents();
                self._invoke(kPostInit);
            })
            .catch(function (error) {
                debug(error);
                self._invoke(kError, [error]);
            });
    }
    else {
        if (!options.bos_credentials && options.uptoken_url
            && options.get_new_uptoken === true) {
            // 服务端动态签名的方式.
            this.client.createSignature = this._getCustomizedSignature(options.uptoken_url);
        }
        else if (options.bos_credentials) {
            this.client.createSignature = function (_, httpMethod, path, params, headers) {
                var credentials = _ || this.config.credentials;
                return sdk.Q.fcall(function () {
                    var auth = new sdk.Auth(credentials.ak, credentials.sk);
                    return auth.generateAuthorization(httpMethod, path, params, headers);
                });
            };
        }
        this._initEvents();
        this._invoke(kPostInit);
    }
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
    // this._invoke(kError, [e, this._currentFile]);
};

Uploader.prototype._onUploadProgress = function (e) {
    var progress = e.lengthComputable
        ? e.loaded / e.total
        : 0;

    // FIXME(leeight) 这种判断方法不太合适.

    var eventType = kUploadProgress;
    if (e._partNumber != null) {
        eventType = kUploadPartProgress;
    }
    else if (this.client._httpAgent
        && this.client._httpAgent._req) {
        var req = this.client._httpAgent._req;
        var uri = req.uri;

        if (/[\?&]append=?&?/.test(uri)) {
            // 这里就不要触发 kUploadProgress 了
            return;
        }

        var headers = req._headers;
        var partNumber = headers['x-bce-meta-part-number'];
        if (partNumber != null) {
            eventType = kUploadPartProgress;
        }
    }

    this._invoke(eventType, [this._currentFile, progress, e]);
};

Uploader.prototype.start = function () {
    if (this._working) {
        return;
    }

    if (this._files.length) {
        this._working = true;
        this._uploadNext();
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

Uploader.prototype._guessTokenMode = function () {
    var options = this.options;
    if (options.bos_token_mode) {
        return options.bos_token_mode;
    }

    if (options.uptoken_url && options.get_new_uptoken === false) {
        return TokenMode.STS;
    }

    return TokenMode.DEFAULT;
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
        })
        .fin(function () {
            // 上传结束（成功/失败），开始下一个
            return self._uploadNext();
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

            return self._listParts(bucket, object, uploadId);
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

Uploader.prototype._listParts = function (bucket, object, uploadId) {
    var self = this;
    var localParts = this._invoke(kListParts, [this._currentFile, uploadId]);

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
        var options = {
            'x-bce-meta-part-number': item.partNumber
        };
        return self.client.uploadPartFromBlob(item.bucket, item.object, item.uploadId,
            item.partNumber, item.partSize, blob, options)
            .then(function (response) {
                ++state.loaded;
                var progress = state.loaded / state.total;
                self._invoke(kUploadProgress, [self._currentFile, progress, null]);

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
                self._invoke(kChunkUploaded, [self._currentFile, result]);

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

Uploader.prototype._uploadNext = function (opt_maxRetries) {
    var file = this._getNext();
    if (file == null || this._abort) {
        // 自动结束了 或者 人为结束了
        this._working = false;
        this._invoke(kUploadComplete);
        return;
    }

    var returnValue = this._invoke(kBeforeUpload, [file]);
    if (returnValue === false) {
        return this._uploadNext();
    }

    // 设置一下当前正在上传的文件，progress 事件需要用到
    this._currentFile = file;

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

    this._getObjectMetadata(bucket, object)
        .then(function (response) {
            var httpHeaders = response.http_headers;
            var appendable = utils.isAppendable(httpHeaders);
            if (!appendable) {
                // Normal Object 不能切换为 Appendable Object
                self._invoke(kUploadProgress, [file, 1, null]);
                return self._uploadNext();
            }

            var contentLength = +(httpHeaders['content-length']);
            if (contentLength >= file.size) {
                // 服务端的文件不小于本地，就没必要上传了
                self._invoke(kUploadProgress, [file, 1, null]);
                return self._uploadNext();
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
            return self._uploadNext();
        })
        .catch(function (error) {
            self._invoke(kError, [error, file]);
            return self._uploadNext();
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

            // 上传成功，开始下一个
            return self._uploadNext();
        })
        .catch(function (error) {
            self._invoke(kError, [error, file]);
            if (error.status_code && error.code && error.request_id) {
                // 应该是正常的错误（比如签名异常），这种情况就不要重试了
                return self._uploadNext();
            }
            else if (maxRetries > 0) {
                // 还有几乎重试
                return self._uploadNextViaPutObject(file, bucket, object, maxRetries - 1);
            }
            // 重试结束了，不管了，继续下一个文件的上传
            return self._uploadNext();
        });
};

module.exports = Uploader;
