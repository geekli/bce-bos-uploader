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


var isChrome = !!navigator.webkitGetUserMedia;
var mediaRecorder;

function main() {
    if (location.protocol === 'http:'
        && location.host === 'leeight.github.io') {
        location.replace(location.href.replace('http:', 'https:'));
        return;
    }

    $('#start').click(startRecording);
}

function startRecording() {
    var text = $(this).text();
    if (text === '开始录制') {
        var mediaConstraints = {
            audio: false,
            // audio: !!navigator.mozGetUserMedia, // don't forget audio!
            video: true                         // don't forget video!
        };
        navigator.getUserMedia(mediaConstraints, onMediaSuccess, onMediaError);
    }
    else if (text === '停止录制'
             && mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.stop();
        mediaRecorder.taskQueue.stop();
        mediaRecorder = null;
        $(this).text('开始录制');
    }
}

function onMediaSuccess(stream) {
    var video = document.querySelector('video#source');
    video.src = URL.createObjectURL(stream);
    video.addEventListener('loadedmetadata', function () {
        $('#start').text('停止录制');

        var taskQueue = new TaskQueue();
        var mirrorUrl = null;
        taskQueue.on('created', function (e) {
            mirrorUrl = e.location;
            var mirror = document.querySelector('video#mirror');
            if (mirror) {
                mirror.src = mirrorUrl;
                $('.mirror-info').html('<a href="' + mirrorUrl + '" target="_blank">视频地址</a>');
            }
        });

        var videoSize = 0;
        mediaRecorder = new MediaStreamRecorder(stream);
        mediaRecorder.stream = stream;
        mediaRecorder.taskQueue = taskQueue;
        mediaRecorder.mimeType = 'video/webm';
        // mediaRecorder.audioChannels = 1;
        mediaRecorder.ondataavailable = function (blob) {
            videoSize += blob.size;
            $('.source-info').text('视频大小：' + humanize.filesize(videoSize));
            taskQueue.enqueue(new Task(blob));
        };
        mediaRecorder.start(3000);

        taskQueue.start()
            .then(function () {
                // 上传结束了
                // var cdnUrl = baidubce.utils.transformUrl(mirrorUrl).replace('.bj.bcebos.com', '.bceimg.com');
                video.src = mirrorUrl;
            })
            .catch(function (error) {
                console.error(error);
            });
    });
}

function onMediaError(error) {
    console.error(error);
}

main();










/* vim: set ts=4 sw=4 sts=4 tw=120: */
