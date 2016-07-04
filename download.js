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

var fs = require('fs');
var path = require('path');
var http = require('http');
var nativeUrl = require('url');

var async = require('async');
var humanize = require('humanize');

const CHUNK_SIZE = 10 * 1024 * 1024;    // 10MB

function download(url, fileSize, dstDir, fileName, callback) {
  var tasks = getTasks(url, fileSize, dstDir, fileName);

  var loadedBytes = 0;
  var totalBytes = fileSize;
  var startTime = Date.now();
  var lastTickTime = Date.now();
  function progressNotifier(bytes) {
    loadedBytes += bytes;
    var time = Date.now() - startTime;
    var pendings = totalBytes - loadedBytes;

    if (Date.now() - lastTickTime < 100) {
      return;
    }

    lastTickTime = Date.now();
    callback([
      loadedBytes,
      time,
      pendings
    ]);
  }

  // 创建临时文件
  var fd = fs.openSync(path.join(dstDir, fileName), 'w');
  var buffer = new Buffer(fileSize);
  buffer.fill(0);
  fs.write(fd, buffer, 0, fileSize, function (err, written, buffer) {
    if (err) {
      console.error(err);
      return;
    }

    async.mapLimit(tasks, 10, downloadPart(progressNotifier), function (err, results) {
      if (err) {
        console.error(err);
      }
      else {
        callback([fileSize, Date.now() - startTime, 0]);
      }
    });
  });
}

function toDHMS(seconds) {
  var days = 0;
  var hours = 0;
  var minutes = 0;

  if (seconds >= 60) {
    minutes = ~~(seconds / 60);
    seconds = seconds - minutes * 60;
  }

  if (minutes >= 60) {
    hours = ~~(minutes / 60);
    minutes = minutes - hours * 60;
  }

  if (hours >= 24) {
    days = ~~(hours / 24);
    hours = hours - days * 24;
  }

  return {DD: days, HH: hours, MM: minutes, SS: seconds};
};

function downloadPart(progressNotifier) {
  return function (item, callback) {
    var parsedUrl = nativeUrl.parse(item.url);
    var requestOptions = {
      hostname: parsedUrl.hostname,
      port: 80,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'Range': item.range
      }
    };
    var request = http.request(requestOptions, function (response) {
      var stream = fs.createWriteStream(path.join(item.dstDir, item.fileName), {
        flags: 'r+',
        start: item.offset,
        autoClose: true,
      });

      response.on('data', function (chunk) {
        progressNotifier(chunk.length);
        stream.write(chunk);
      });
      response.on('end', function (chunk) {
        stream.end(chunk, callback);
      });
    });
    request.on('error', callback);
    request.end();
  }
}

function getTasks(url, fileSize, dstDir, fileName) {
  var leftSize = fileSize;
  var offset = 0;
  var partNumber = 1;

  var tasks = [];

  while (leftSize > 0) {
    var partSize = Math.min(leftSize, CHUNK_SIZE);

    tasks.push({
      url: url,
      dstDir: dstDir,
      fileName: fileName,
      partNumber: partNumber,
      partSize: partSize,
      offset: offset,
      range: 'bytes=' + offset + '-' + (offset + partSize - 1)
    });

    leftSize -= partSize;
    offset += partSize;
    partNumber += 1;
  }

  return tasks;
}

//*
var url = 'http://bce-bos-uploader.bceimg.com/2016/06/22/100M.rar';
// var url = 'http://bce-bos-uploader.bceimg.com/2016/07/04/1M.avi';
// var url = 'http://bce-bos-uploader.bceimg.com/2016/07/04/19M.rar';
// var url = 'http://bce-bos-uploader.bceimg.com/2016/07/04/hello.txt';
var dstDir = path.join(__dirname, 'dst');
var fileName = path.basename(url);
download(url, 100 * 1024 * 1024, dstDir, fileName, function (state) {
  console.log(state);
});
//*/


exports.download = download;
