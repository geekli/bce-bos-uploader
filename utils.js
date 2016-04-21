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


var __queryMap = null;
function getQuery(id, opt_defaultValue) {
  if (!__queryMap) {
    __queryMap = {};
    var string = location.search.substr(1);
    if (string) {
      var chunks = string.split('&');
      for (var i = 0; i < chunks.length; i++) {
        var item = chunks[i].split('=');
        var key = item[0];
        var value = item[1];
        if (value) {
          value = decodeURIComponent(value);
        }
        __queryMap[key] = value;
      }
    }
  }
  return __queryMap[id] || opt_defaultValue;
}










/* vim: set ts=4 sw=4 sts=4 tw=120: */
