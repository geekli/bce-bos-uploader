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

var AK = getQuery('ak', '07e08ee9530d400f83ff8a82a30d5f71');
var SK = getQuery('sk', 'fde2d76826f244738e9924c66796b3a8');
var DOC_ENDPOINT = getQuery('doc.endpoint', 'http://doc.baidubce.com');
var BOS_ENDPOINT = getQuery('bos.endpoint', 'http://bj.bcebos.com');
var BOS_BUCKET = getQuery('bos.bucket', 'bce-bos-uploader');
var CHUNK_SIZE = '1m';

var doc = new baidubce.sdk.DocClient.Document({
  endpoint: DOC_ENDPOINT,
  credentials: {ak: AK, sk: SK}
});

var documentId = getQuery('id');
if (!documentId) {
  alert('No documentId found.');
}
else {
  doc.read(documentId).then(function (response) {
    document.title = getQuery('title');

    var doc = response.body;
    new Document('reader', {
      docId: doc.docId,
      token: doc.token,
      host: doc.host,
      width: 800
    });
  });
}










/* vim: set ts=4 sw=4 sts=4 tw=120: */
