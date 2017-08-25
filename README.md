### Baidu Cloud Engine BOS Uploader (Lite)

bce-bos-uploader-lite 是 [bce-bos-uploader](https://github.com/leeight/bce-bos-uploader) 的精简版，裁剪了不太常用的功能组件，保留了核心的上传功能，当前 1.0.5 版本 `*.min.js` 文件大小在 gzip 前后的情况是 47k / 16k。

### 支持的浏览器

IE8+, Firefox, Chrome, Safari, Opera

```html
<!--[if lte IE 9]><script src="https://cdn.rawgit.com/moxiecode/moxie/v1.4.1/bin/js/moxie.min.js"></script><![endif]-->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>
<script src="https://bce.bdstatic.com/bce-bos-uploader-lite/1.0.5/bce-bos-uploader-lite.min.js"></script>
```

### 如何使用

#### 初级：初始化 bucket

主要是完成 bucket cors 的配置，可以参考 [文档手工完成设置](https://cloud.baidu.com/doc/BOS/BestPractise.html#.7B.0B.56.71.A6.B0.9A.33.4D.A1.4E.F2.A8.19.1D.A0)，或者借助 [bce-sdk-js-usage](https://github.com/leeight/bce-sdk-js-usage) 自动初始化。

> NOTE: 这里推荐使用 [bce-sdk-js-usage](https://github.com/leeight/bce-sdk-js-usage) 来初始化操作，因为它包含了一些服务端所需的代码，后续签名计算的逻辑需要借助它来完成。

执行 `npm run prepare` 之后，如果顺利的话，应该可以看到类似如下的输出：

```
Generated backend/php/Config.php
Generated backend/java/src/main/java/com/baidu/inf/bce/Config.java
Add cors config to bos://<your bucket>
Set public-read to bos://<your bucket>
crossdomain.xml to bos://<your bucket>/crossdomain.xml
```

#### 初级：准备一个最简单的页面

请参考这个示例页面 [basic.html](http://cdn.rawgit.com/leeight/bce-bos-uploader-lite/2ca620c4e0a4bbb72adeba7a2aa785a2b73cb955/demo/basic.html)。

如果你的 bucket 不是 bj region，那么请在 `bos_endpoint` 地方填写实际的地址。

|*region*|*endpoint*|
|-----|-----|
|bj|http://bj.bcebos.com|
|gz|http://gz.bcebos.com|
|su|http://su.bcebos.com|
|hk|http://hk.bcebos.com|

Uploader初始化的时候，需要设置 `browse_button` 参数，如果需要支持低版本的IE，还需要设置 `flash_swf_url` 参数，例如：

```javascript
var uploader = new baidubce.bos.Uploader({
  browse_button: '#file',
  flash_swf_url: '../bower_components/moxie/bin/flash/Moxie.swf',
  ...
```
> `flash_swf_url` 的地址需要跟当前页面是同域的

如果上面的操作一切顺利的话，此时就可以在 [basic.html](http://cdn.rawgit.com/leeight/bce-bos-uploader-lite/2ca620c4e0a4bbb72adeba7a2aa785a2b73cb955/demo/basic.html) 实现文件直传的工作。

#### 初级：关于 uptoken_url

不过在实际应用中，出于安全因素的考虑，`bos_ak` 和 `bos_sk` 是不会暴露出来的，所以我们支持了 `uptoken_url` 参数来在服务器动态的计算签名。用法也很简单，只需要在初始化的时候，设置这个参数即可：

```javascript
var uploader = new baidubce.bos.Uploader({
  browse_button: '#file',
  flash_swf_url: '../bower_components/moxie/bin/flash/Moxie.swf',
  multi_selection: true,
  uptoken_url: 'http://localhost:8801/ack', // <-- 新增的参数
  ...
```

然后按照 [bce-sdk-js-usage](https://github.com/leeight/bce-sdk-js-usage) 的 README 里面的介绍，启动一个服务，比如 `cd backend/nodejs && node main.js`

完整的例子请参考：[uptoken_url.html](http://cdn.rawgit.com/leeight/bce-bos-uploader-lite/2ca620c4e0a4bbb72adeba7a2aa785a2b73cb955/demo/uptoken_url.html)

#### 中级：关于 get_new_uptoken

在 uptoken_url.html 示例中，每次上传文件的时候，都会请求 `uptoken_url` 来计算签名。现在 BOS 已经支持了 [临时访问授权](https://cloud.baidu.com/doc/BOS/API/15.5CSTS.E7.AE.80.E4.BB.8B.html) 的机制，所以在初始化的时候，通过设置 `get_new_uptoken: false`，可以让 Uploader 自动从 `uptoken_url` 获取一个临时的 ak, sk, sessionToken，之后文件上传的时候就可以在浏览器端计算签名了，从而可以减少对 `uptoken_url` 的访问。

```javascript
var uploader = new baidubce.bos.Uploader({
  browse_button: '#file',
  flash_swf_url: '../bower_components/moxie/bin/flash/Moxie.swf',
  multi_selection: true,
  uptoken_url: 'http://localhost:8801/ack',
  get_new_uptoken: false,       // <-- 新增的参数
  ...
```

> 这种情况下，如果在 Uploader 初始化的时候，没有设置 `bos_bucket` 参数，是无法正常的初始化 ak, sk, sessionToken，也就无法上传文件。所以需要在执行 `uploader.setOptions()` 设置了 `bos_bucket` 之后，手工调用 `uploader.refreshStsToken()` 重新初始化一下，之后才可以调用 `uploader.start()`。

```javascript
uploader.setOptions({
  bos_bucket: bucket,
  bos_endpoint: endpoint
});
uploader.refreshStsToken().then(function () {        
  uploader.start();
})
```

完整的例子请参考：[get_new_uptoken.html](http://cdn.rawgit.com/leeight/bce-bos-uploader-lite/2ca620c4e0a4bbb72adeba7a2aa785a2b73cb955/demo/get_new_uptoken.html)

#### 高级：关于 uptoken 的有效期

通过 STS 获取的临时授权，如果过期之后，需要重新获取。为了尽可能降低过期的情况出现的概率，可以在每次文件上传之前，重新获取一次 STS 临时授权。

> 其实就这个时候就跟在服务器端签名的情况基本差不多了，唯一不同的情况是对于分片上传的时候每个分片是不需要往服务器端发请求的，可以在浏览器端计算出来

```javascript
var uploader = new baidubce.bos.Uploader({
  ...
  init: {
    Key: function (_, file) {
      var kBucket = $('#bos_bucket').val();
      var kBosEndpoint = $('#bos_endpoint').val();
      var kUptokenUrl = 'http://localhost:8801/ack';
      var sts = JSON.stringify(baidubce.utils.getDefaultACL(kBucket));
      
      var deferred = baidubce.sdk.Q.defer();
      $.ajax({
        url: kUptokenUrl,
        dataType: 'jsonp',
        data: {sts: sts, filename: file.name}
      }).done(function (payload) {
        uploader.setOptions({
          bos_ak: payload.AccessKeyId,
          bos_sk: payload.SecretAccessKey,
          uptoken: payload.SessionToken,
          bos_endpoint: kBosEndpoint
        });
        
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
        var key = year + '/' + month + '/' + day + '/' + file.name;
        deferred.resolve({key: key, bucket: kBucket});
      });
      return deferred.promise;
    }
  },
  ...
```

完整的例子请参考：[advanced.html](http://cdn.rawgit.com/leeight/bce-bos-uploader-lite/2ca620c4e0a4bbb72adeba7a2aa785a2b73cb955/demo/advanced.html)

### Uploader 支持的配置参数

#### 基本设置

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|browse_button|Y|无|例如 `#file`|
|bos_bucket|N|无|需要上传到的Bucket|
|bos_endpoint|N|http://bj.bcebos.com|BOS服务器的地址|
|bos_task_parallel|N|3|队列中文件并行上传的个数|
|auto_start|N|false|选择文件之后，是否自动上传|
|multi_selection|N|false|是否可以选择多个文件|
|accept|N|-|可以支持选择的文件类型，例如 `mp4,avi,txt` 等等|
|flash_swf_url|Y|-|mOxie Flash文件的地址。如果要支持IE低版本，必须设置这个参数，而且需要跟所处的页面是同域的|

> 对于 accept 属性，需要注意的是，在 Safari 下面，只能设置 mime-type，设置文件名后缀是没有效果的。所以一般建议这么使用：
> ...
> accept: isSafari ? 'video/mp4' : 'mp4'
> ...

#### 认证相关

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|uptoken_url|N|无|用来进行服务端签名的URL，需要支持JSONP|
|bos_ak|N|无|如果没有设置`uptoken_url`的话，必须有`ak`和`sk`这个配置才可以工作|
|bos_sk|N|无|如果没有设置`uptoken_url`的话，必须有`ak`和`sk`这个配置才可以工作|
|uptoken|N|无|sts token的内容|
|get_new_uptoken|N|true|如果设置为false，会自动获取到Sts Token，上传的过程中可以减少一些请求|

#### 失败重试

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|max_retries|N|0|如果上传文件失败之后，支持的重试次数。默认不重试|
|retry_interval|N|1000|如果失败之后，重试的间隔，默认1000ms|

#### 大文件相关（分片上传相关的参数）

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|max_file_size|N|100M|可以选择的最大文件，超过这个值之后，会被忽略掉|
|bos_multipart_min_size|N|10M|超过这个值之后，采用分片上传的策略。如果想让所有的文件都采用分片上传，把这个值设置为0即可。**如果浏览器不支持xhr2，这个设置是无意义的**|
|chunk_size|N|4M|分片上传的时候，每个分片的大小（如果没有切换到分片上传的策略，这个值没意义）|

### 支持的事件

在 Uploader初始化的时候，可以通过设置 init 来传递一些回掉函数，然后 Uploader 在合适的时机，会调用这些回掉函数。例如：

```javascript
var uploader = new baidubce.bos.Uploader({
  init: {
    PostInit: function () {
      // uploader 初始化完毕之后，调用这个函数
    },
    Key: function (_, file) {
      // 如果需要重命名 BOS 存储的文件名称，这个函数
      // 返回新的文件名即可
      // 如果这里需要执行异步的操作，可以返回 Promise 对象
      // 如果需要自定义bucket和object，可以返回{bucket: string, key: string}
      // 例如：
      // return new Promise(function (resolve, reject) {
      //   setTimeout(function () {
      //     resolve(file.name);
      //     或者
      //     resolve({key: file.name, bucket: 'xxx'});
      //   }, 2000);
      // });
    },
    FilesAdded: function (_, files) {
      // 当文件被加入到队列里面，调用这个函数
    },
    FilesFilter: function (_, files) {
      // 如果需要对加入到队列里面的文件，进行过滤，可以在
      // 这个函数里面实现自己的逻辑
      // 返回值需要是一个数组，里面保留需要添加到队列的文件
    },
    BeforeUpload: function (_, file) {
      // 当某个文件开始上传的时候，调用这个函数
      // 如果想组织这个文件的上传，请返回 false
    },
    UploadProgress: function (_, file, progress, event) {
      // 文件的上传进度
    },
    NetworkSpeed: function (_, bytes, time, pendings) {
      var speed = bytes / time;             // 上传速度
      var leftTime = pendings / (speed);    // 剩余时间
      console.log(speed, leftTime);
    },
    FileUploaded: function (_, file, info) {
      // 文件上传成功之后，调用这个函数
      var url = info.body.location;
      console.log(url);
    },
    UploadPartProgress: function (_, file, progress, event) {
      // 分片上传的时候，单个分片的上传进度
    },
    ChunkUploaded: function (_, file, result) {
      // 分片上传的时候，单个分片上传结束
    },
    Error: function (_, error, file) {
      // 如果上传的过程中出错了，调用这个函数
    },
    UploadComplete: function () {
      // 队列里面的文件上传结束了，调用这个函数
    }
  }
});
```

> 需要注意的时候，所以回掉函数里面的一个参数，暂时都是 null，因此上面的例子中用 _ 代替，后续可能会升级


### 对外提供的接口

#### start()

当 auto_start 设置为 false 的时候，需要手工调用 `start` 来开启上传的工作。

#### stop()

调用 stop 之后，会终止对文件队列的处理。需要注意的是，不是立即停止上传，而是等到当前的文件处理结束（成功/失败）之后，才会停下来。

### remove(file)

删除队列中的一个文件，如果文件正在上传，那么就会中断上传。

### addFile(file)

动态的往上传队列中添加一个文件，只支持 [W3C File API](https://www.w3.org/TR/FileAPI/)

### setOptions(options)

动态的设置 bce-bos-uploader-lite 的参数，目前只支持设置如下几个参数：

1. `bos_credentials`, `bos_ak`, `bos_sk`
2. `uptoken`
3. `bos_bucket`
4. `bos_endpoint`
