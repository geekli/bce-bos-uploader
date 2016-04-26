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

var AK = getQuery('ak', 'afe4759592064eee930682e399249aba');
var SK = getQuery('sk', '7785ea912b06449f8cbd084998a1e400');
var VOD_ENDPOINT = getQuery('vod.endpoint', 'http://vod.baidubce.com');

var vod = new baidubce.sdk.VodClient({
  endpoint: VOD_ENDPOINT,
  credentials: {ak: AK, sk: SK}
});


var mediaId = getQuery('id');
if (!mediaId) {
  alert('No mediaId found.');
}
else {
  vod.getPlayerCode(mediaId, 800, 500, true).then(function (response) {
    var codes = response.body.codes;
    location.replace(codes[2].sourceCode);
  });
}










/* vim: set ts=4 sw=4 sts=4 tw=120: */
