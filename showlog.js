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

console.log('serving version %s', version);

var options = {
  ca: fs.readFileSync('./certs/lamassu.pem'),
  key: fs.readFileSync('./keys/privkey.pem'),
  cert: fs.readFileSync('./certs/lamassu.pem'),
  secureProtocol: 'TLSv1_method',
  requestCert: true,
  rejectUnauthorized: false,
  ciphers: 'AES128-GCM-SHA256:RC4:HIGH:!MD5:!aNULL:!EDH',
  honorCipherOrder: true
};

var contentSig = packageInfo.contentSig;
console.log(contentSig);
// TODO: verify sig

process.on('SIGINT', function() { console.log('quitting'); process.exit(); });
process.on('SIGTERM', function() { console.log('terminating'); process.exit(); });

var downloading = {};
var logNum = 0;

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

function handleLog(req, res) {
  logNum += 1;
  console.log('receiving log %d', logNum);
  var ws = fs.createWriteStream('logs/log.' + logNum + '.txt');
  req.pipe(ws);
  req.on('end', function() {
    console.log('received log %d', logNum);
    res.writeHead(200, {'content-type': 'text/plain'});
    res.end();          
  });
}

function handleDownload(req, res, clientCert) {
  var fingerprint = clientCert.fingerprint;
  req.resume();

  // TODO: remove the whole downloading table once we fix the updaters
  var ignore = req.connection.remoteAddress !== targetIp;
  if (ignore || downloading[fingerprint]) {
    // TODO: This is a hack to solve the bug in the updater client
    res.setTimeout(2000, function() { console.log('timed out'); });

    res.writeHead(304, {'content-type': 'text/plain'});
    res.end('Up to date\n');    
  } else {
    console.log(200);
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
      console.log('********* Download completed *********');
      setTimeout(function() {
        downloading[fingerprint] = false;
      }, 300000);
    });
  }
}

var s = https.createServer(options, function (req, res) {
  var timestamp = new Date().toISOString();
  var clientCert = req.connection.getPeerCertificate();
  var subject = clientCert.subject;
  //console.log('\n%s\t%s (%s, %s) [%s]', timestamp,
  //    subject.O, subject.L, subject.C, req.connection.remoteAddress);
  var fingerprint = clientCert.fingerprint;

  if (req.url === '/report') {
    handleReport(req, res, clientCert);
  } else if (req.url === '/log') {
    handleLog(req, res);    
  } else if (req.url === '/') {
    handleDownload(req, res, clientCert);
  } else {
    console.log('unknown path: %s', req.url);
  }
}).listen(8000);

s.on('error', console.log);
s.on('clientError', function(err) { console.log('client error: %s', err.message); });
s.on('close', function() { console.log('close'); });
