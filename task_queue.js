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
 */

var TaskState = {
    INIT: 0,
    RUNNING: 1,
    STOPPED: 2
};

var kCREATED = 'created';

/**
 * 调用 bce-sdk-js 的 API，通过 Appendable 的方式上传
 *
 * @constructor
 */
function TaskQueue() {
    EventEmitter.call(this);

    /**
     * @type {Array.<*>}
     */
    this._tasks = [];

    this._state = TaskState.INIT;

    this._bucket = 'bce-bos-uploader';

    this._endpoint = 'https://bj.bcebos.com';

    this._object = this._getDefaultKey();
}
TaskQueue.prototype = Object.create(EventEmitter.prototype);
TaskQueue.prototype.constructor = TaskQueue;

/**
 * 开始启动上传的队列
 *
 * @return {Promise}
 */
TaskQueue.prototype.start = function () {
    var self = this;

    if (self._state === TaskState.RUNNING) {
        return;
    }

    return self._createClient().then(function (client) {
        self._state = TaskState.RUNNING;
        return self._startUpload(client);
    });
};

TaskQueue.prototype._createClient = function () {
    var bucket = this._bucket;
    var uptoken_url = 'http://180.76.133.248:1337/ack';
    var timeout = 5000;

    var deferred = baidubce.sdk.Q.defer();
    $.ajax({
        url: uptoken_url,
        jsonp: 'callback',
        dataType: 'jsonp',
        timeout: timeout,
        data: {
            sts: JSON.stringify(baidubce.utils.getDefaultACL(bucket))
        },
        success: function (payload) {
            var client = new baidubce.sdk.BosClient({
                endpoint: self._endpoint,
                credentials: {
                    ak: payload.AccessKeyId,
                    sk: payload.SecretAccessKey
                },
                sessionToken: payload.SessionToken
            });
            deferred.resolve(client);
        },
        error: function () {
            deferred.reject(new Error('Get sts token timeout (' + timeout + 'ms).'));
        }
    });
    return deferred.promise;
};

TaskQueue.prototype._getDefaultKey = function () {
    var date = new Date();
    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    if (month < 10) {
        month = '0' + month;
    }
    var day = date.getDate();
    if (day < 10) {
        day = '0' + day;
    }

    var name = new Date().getTime() + '.mp4';

    var key = year + '/' + month + '/' + day + '/' + name;

    return key;
};

TaskQueue.prototype._startUpload = function (client) {
    var self = this;
    var bucket = this._bucket;
    var object = this._object;
    var deferred = baidubce.sdk.Q.defer();

    var offsetArgument = null;

    function resolve(response) {
        if (offsetArgument == null) {
            // XXX CDN会被缓存，应该用源站的
            // var url = 'http://' + bucket + '.bceimg.com/' + object;
            var url = self._endpoint + '/' + bucket + '/' + object;
            self.emit(kCREATED, {location: url});
        }

        var httpHeaders = response.http_headers;
        offsetArgument = +httpHeaders['x-bce-next-append-offset'];
        setTimeout(infiniteLoop, 50);
    }

    function waitSeconds(ms) {
        setTimeout(infiniteLoop, ms);
    }

    function reject(error) {
        deferred.reject(error);
    }

    function infiniteLoop() {
        var task = self.dequeue();
        if (!task) {
            if (self._state === TaskState.RUNNING) {
                // 队列已经空了，说明数据产生的太慢，那就等一会儿？
                waitSeconds(1000);
            }
            else if (self._state === TaskState.STOPPED) {
                // 手动停止了
                deferred.resolve();
            }
            return;
        }

        var blob = task.blob;
        var contentType = baidubce.sdk.MimeType.guess('mp4');
        var options = {
            'Content-Type': contentType,
            'Content-Length': blob.size
        };
        client.appendObjectFromBlob(bucket, object, blob,
            offsetArgument, options).then(resolve, reject);
    }
    infiniteLoop();

    return deferred.promise;
};

TaskQueue.prototype.stop = function () {
    this._state = TaskState.STOPPED;
};

TaskQueue.prototype.clear = function () {
    this._tasks.length = 0;
};

/**
 * MediaStreamRecorder 收到数据之后，放到队列中即可，后续 TaskQueue 会负责上传的
 *
 * @param {*} task 主要封装了一个 blob 对象.
 */
TaskQueue.prototype.enqueue = function (task) {
    this._tasks.push(task);
};

TaskQueue.prototype.dequeue = function () {
    return this._tasks.shift();
};









/* vim: set ts=4 sw=4 sts=4 tw=120: */
