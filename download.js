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

const CHUNK_SIZE = 5 * 1024 * 1024;    // 5M

function download(url, fileSize, dstDir, fileName, callback) {
  var tasks = getTasks(url, fileSize, dstDir, fileName);

  var loadedBytes = 0;
  var totalBytes = fileSize;
  var startTime = Date.now();
  function progressNotifier(bytes) {
    loadedBytes += bytes;
    var time = Date.now() - startTime;
    var pendings = totalBytes - loadedBytes;

    callback([
      loadedBytes,
      time,
      pendings
    ]);
  }

  async.mapLimit(tasks, 10, downloadPart(progressNotifier), function (err, results) {
    if (err) {
      console.error(err);
    }
    else {
      callback([fileSize, Date.now() - startTime, 0]);
    }
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
      var payload = [];
      response.on('data', function (chunk) {
        progressNotifier(chunk.length);
        payload.push(chunk);
      });
      response.on('end', function () {
        var dst = path.join(item.dstDir, item.partNumber + '.' + item.partSize + '.' + item.fileName);
        fs.writeFile(dst, Buffer.concat(payload), callback);
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
      range: 'bytes=' + offset + '-' + (offset + partSize - 1)
    });

    leftSize -= partSize;
    offset += partSize;
    partNumber += 1;
  }

  return tasks;
}

/*
var url = 'http://bce-bos-uploader.bceimg.com/2016/06/22/100M.rar';
var dstDir = path.join(__dirname, 'dst');
var fileName = path.basename(url);
download(url, 100 * 1024 * 1024, dstDir, fileName);
*/


exports.download = download;
