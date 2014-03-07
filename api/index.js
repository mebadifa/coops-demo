(function() {
  
  var crypto = require('crypto');
  var _ = require('underscore');
  var ObjectId = require('mongojs').ObjectId;
  
  var db = require('../db');
  var algorithms = require('../algorithms');
  
  var COOPS_PROTOCOL_VERSION = "1.0.0";
  
  function findFile(fileId, done) {
    if (!fileId) {
      done(null, null);
    }
    
    db.files.findOne({ _id: new ObjectId(fileId.toString()) }, done);
  }
  
  module.exports = {
    
    fileGet: function (req, res) {
      var revisionNumber = parseInt(req.query.revisionNumber, 10);
      if (isNaN(revisionNumber)) {
        findFile(req.params.fileid, function (err, file) {
          if (err) {
            res.send(500, err);
          } else {
            if (!file) {
              res.send(404, "Not Found");
            } else {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.send(200, JSON.stringify({
                "revisionNumber": file.revisionNumber,
                "content": file.content,
                "contentType": file.contentType,
                "properties": file.properties
              }));
            }
          }
        });
      } else {
        res.send(501, "Not implemented");
      }
    },
    
    fileUpdate: function (req, res) {
      var revisionNumber = parseInt(req.query.revisionNumber, 10);
      if (isNaN(revisionNumber)) {
        res.send(400, "revisionNumber parameter is missing");
        return;
      }
      
      findFile(req.params.fileid, function (err, file) {
        if (err) {
          res.send(500, err);
        } else {
          if (!file) {
            res.send(404, "Not Found");
          } else {
            
            db.filerevisions.find( { fileId: file._id,  "revisionNumber": { $gt: revisionNumber } }, function (err, fileRevisions) {
              if (err) {
                res.send(err, 500);
              } else {
                if (fileRevisions.length === 0) {
                  res.send(204);
                } else {
                  var patches = [];
                  
                  for (var i = 0, l = fileRevisions.length; i < l; i++) {
                    var fileRevision = fileRevisions[i];
                    // TODO: Extensions
                    patches.push({
                      "sessionId": fileRevision.sessionId,
                      "revisionNumber": parseInt(fileRevision.revisionNumber, 10),
                      "checksum": fileRevision.checksum,
                      "patch": fileRevision.patch,
                      "properties": fileRevision.properties,
                      "extensions": { }
                    });
                  }

                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.send(200, JSON.stringify(patches));
                }
              }
            });
          }
        }
      });
    },
    
    filePatch: function (req, res) {
      var fileId = req.params.fileid;
      var user = req.user;
      var reqBody = req.body;
      var valid = true;
      var message = null;
      var status = 200;
      var algorithm = null;
      
      if (!reqBody || !reqBody.sessionId) {
        valid = false;
        message = "Invalid request";
        status = 400;
      }
      
      db.sessions.findOne({ _id: new ObjectId( reqBody.sessionId.toString() ) }, function (sessionErr, session) {
        if (sessionErr) {
          res.send(sessionErr, 500);
          return;
        }
        
        if (!session) {
          res.send("Session could not be found", 403);
          return;
        }

        if (reqBody.patch) {
          algorithm = algorithms.getAlgorithm(session.algorithm);
          if (!algorithm) {
            valid = false;
            message = "Algorithm is not supported by this server";
            status = 400;
          }
        }
        
        if (!valid) {
          res.send(message, status);
        } else {
          findFile(fileId, function (err, file) {
            if (err) {
              res.send(err, 500);
            } else {
              if (file.revisionNumber != reqBody.revisionNumber) {
                res.send("Server version does not match client version", 409);
              } else {
                var patchRevisionNumber = file.revisionNumber + 1;
                var patch = reqBody.patch;
                var content = null;
                var checksum = null;
                var sessionId = reqBody.sessionId;
                
                if (reqBody.patch) {
                  var patchResult = algorithm.patch(reqBody.patch, file.content);
                  if (patchResult.applied) {
                    content = patchResult.patchedText;
                    checksum = crypto.createHash('md5').update(content).digest('hex');
                  } else {
                    res.send("Could not apply the patch", 409);
                    return;
                  }
                } else {
                  content = file.content;
                }
                
                db.filerevisions.insert({
                  fileId: file._id,
                  revisionNumber: patchRevisionNumber,
                  patch: patch,
                  checksum: checksum,
                  sessionId: sessionId,
                  properties: reqBody.properties
                }, function (revisionErr, fileRevision) {
                  if (revisionErr) {
                    res.send(revisionErr, 500);
                  } else {
                    var properties = _.extend(file.properties||{}, fileRevision.properties);
                    db.files.update({ _id: new ObjectId(fileId.toString()) },{ content: content, revisionNumber: patchRevisionNumber, properties: properties, contentType: file.contentType, }, { multi: false }, function(updateErr) {
                      if (updateErr) {
                        res.send(updateErr, 500);
                      } else {
                        res.send(204);
                      }
                    });
                  }
                });
              }
            }
          });
        }
      });
    },
    
    fileJoin: function (req, res) {
      findFile(req.params.fileid, function (err, file) {
        if (err) {
          res.send(500, err);
        } else {
          if (!file) {
            res.send(404, "Not Found");
          } else {
            var clientAlgorithms = req.query.algorithm;
            var protocolVersion = req.query.protocolVersion;
            
            if (!(clientAlgorithms instanceof Array)) {
              clientAlgorithms = new Array(clientAlgorithms);
            }
            
            if ((clientAlgorithms.length === 0)||(!protocolVersion)) {
              res.send(500, "Invalid request");
              return;
            }
            
            if (COOPS_PROTOCOL_VERSION !== protocolVersion) {
              res.send(501, "Protocol version mismatch. Client is using " + protocolVersion + " and server " + COOPS_PROTOCOL_VERSION);
              return;
            }
            
            var algorithm = null;
            
            for (var i = 0, l = clientAlgorithms.length; i < l; i++) {
              var clientAlgorithm = clientAlgorithms[i];
              algorithm = algorithms.getAlgorithm(clientAlgorithm);
              if (algorithm !== null) {
                // TODO: Check content type
                // TODO: Appropriate for the file?
                break;
              }
            }
            
            if (!algorithm) {
              res.send(501, "Server and client do not have a commonly supported algorithm. " +
                  "Server supported: " + algorithms.getAlgorithms().toString() + ", " +
                  "Client supported: " + clientAlgorithms.toString());
              return;
            } else {
              db.sessions.insert({ userId: req.user.id, algorithm: algorithm.getName() }, function (sessionErr, session) {
                if (sessionErr) {
                  res.send(500, sessionErr);
                } else {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.send(200, JSON.stringify({
                    "sessionId": session._id,
                    "algorithm": session.algorithm,
                    "revisionNumber": parseInt(file.revisionNumber, 10),
                    "content": file.content,
                    "contentType": file.contentType,
                    "properties": file.properties,
                    "extensions": {
                      "x-http-method-override": {}
                    }
                  }));
                }
              });
              
            }
          }
        }
      });
    }
    
  };
  
}).call(this);