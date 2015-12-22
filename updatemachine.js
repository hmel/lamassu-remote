'use strict';

// Run this to check machine info from update requests. 
// This is a temporary measure. This file can be deleted once all images are
// correctly configured.

var machineId = process.argv[2];
var targetIp = process.argv[3];
var BASE = '../sencha-packages/package/' + machineId;
var https = require('https');
var fs = require('fs');

var path = BASE + '/update.tar';
var packageInfoPath = BASE + '/info.json';
var fileSize = fs.statSync(path).size;

var packageInfo = JSON.parse(fs.readFileSync(packageInfoPath));
var version = packageInfo.version;

var count = 0;
var completedCount = 0;

console.log('serving version %s', version);

var options = {
  ca: fs.readFileSync('./certs/lamassu.pem'),
  key: fs.readFileSync('./keys/privkey.pem'),
  cert: fs.readFileSync('./certs/lamassu.pem'),
  secureProtocol: 'TLSv1_method',
  requestCert: true,
  ciphers: 'AES128-GCM-SHA256:RC4:HIGH:!MD5:!aNULL:!EDH',
  honorCipherOrder: true
};

var contentSig = packageInfo.contentSig;
console.log(contentSig);
// TODO: verify sig

process.on('SIGINT', function() { console.log('quitting'); process.exit(); });
process.on('SIGTERM', function() { console.log('terminating'); process.exit(); });

var downloading = {};

function handleReport(req, res) {
  console.log('receiving report');
  var buf = '';
  req.on('data', function(chunk) { buf += chunk; });
  req.on('end', function() {
    var json = JSON.parse(buf);
    if (json.error) console.log('error: %s', json.error);
    console.log('result: %s', json.result);
  });
  res.writeHead(200, {'content-type': 'text/plain'});
  res.end('Report received\n');          
}

function handleDownload(req, res, clientCert) {
  var fingerprint = clientCert.fingerprint;
  req.resume();

  // TODO: remove the whole downloading table once we fix the updaters
  var ignore = req.connection.remoteAddress !== targetIp || count > 0;
  if (ignore) {
    // TODO: This is a hack to solve the bug in the updater client
    res.setTimeout(2000, function() { console.log('timed out'); });

    res.writeHead(304, {'content-type': 'text/plain'});
    res.end('Up to date\n');    
  } else {
    console.log(200);
    count += 1;
    console.log('Downloading #%d', count);
    downloading[fingerprint] = true;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': fileSize, 
      'content-disposition': 'attachment; filename=update-10.luf',
      'content-version': version,
      'content-sig': contentSig
    });

    var readStream = fs.createReadStream(path);
    readStream.pipe(res);
    readStream.on('end', function() {
      completedCount += 1;
      console.log('********* Download completed [%d/%d] *********', completedCount, count);
    });
  }
}

var s = https.createServer(options, function (req, res) {
  var clientIp = req.connection.remoteAddress;
  var timestamp = new Date().toISOString();
  var clientCert = req.connection.getPeerCertificate();
  var deviceId = req.headers['device-id'];
  var remoteVersionString = req.headers['application-version'];

  if (clientIp === targetIp) {
    console.log('%s | %s | %s | %s', timestamp, remoteVersionString, deviceId, clientIp);
  }

  if (req.url === '/report') {
    handleReport(req, res, clientCert);
  } else if (req.url === '/') {
    handleDownload(req, res, clientCert);
  } else {
    console.log('unknown path: %s', req.url);
  }
}).listen(8000);

s.on('error', console.log);
s.on('clientError', function(err) { console.log('client error: %s', err.message); });
s.on('close', function() { console.log('close'); });
