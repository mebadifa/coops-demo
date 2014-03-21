(function() {
  /* global CKEDITOR, diff_match_patch, hex_md5, MockIOHandler:true */

  var PROTOCOL_VERSION = "1.0.0";
  var ALGORITHMS = ["dmp"];
  
  CKEDITOR.plugins.addExternal('change', '/ckplugins/change/');
  CKEDITOR.plugins.addExternal('coops', '/ckplugins/coops/');
  CKEDITOR.plugins.addExternal('coops-dmp', '/ckplugins/coops-dmp/');
  CKEDITOR.plugins.addExternal('coops-rest', '/ckplugins/coops-rest/');
  
  MockIOHandler = CKEDITOR.tools.createClass({
    $: function(options) {
      this.options = options;
    },
    
    proto : {
      get: function (url, parameters, callback) {
        this.options.get(url, parameters, callback);
      },
      patch: function (url, object, callback) {
        this.options.patch(url, object, callback);
      }
    }
  });
  
  $.widget("custom.TestCK", {
    options: {
      
    },
    _create : function() {
      
      
      this._editor = CKEDITOR.appendTo($('<div>').appendTo(this.element).get(0), {
        toolbar: [
          { name: 'insert', items : [ 'Image','Table','HorizontalRule','SpecialChar'] },
          { name: 'styles', items : [ 'Styles','Format' ] },
          { name: 'basicstyles', items : [ 'Bold','Italic','Strike','-','RemoveFormat' ] }
        ],
        extraPlugins: 'coops,coops-dmp,coops-rest',
        readOnly: true,
        coops: {
          serverUrl: '-',
          mode: 'development',
          restIOHandler: new MockIOHandler({
            get: $.proxy(this._mockGetRequest, this),
            patch: $.proxy(this._mockPatchRequest, this)
          })
        }
      });
      
      this.element.append($('<div>')
        .addClass('ck-actions')
        .append($('<a>').addClass('ck-action-update').text('Update').attr('href', '#').click($.proxy(this._onUpdateClick, this)))
      );
    },
    
    _mockGetRequest: function (url, parameters, callback) {
      var paramMap = {};
      $.each(parameters, function (i, parameter) {
        paramMap[parameter.name] = parameter.value;
      });
      
      if (url === '-/join') {
        this._mockJoin(paramMap, callback);
      } else if (url === '-/update') {
        this._mockUpdate(paramMap, callback);
      } else {
        console.log(["mock-get", url, parameters, callback]);
      }
    },
    
    _mockPatchRequest: function (url, parameters, callback) {
      $('#server').TestServer('patch', parameters.sessionId, parameters.revisionNumber, parameters.patch, parameters.properties, parameters.extensions, $.proxy(function (status) {
        console.log(['patch', url, parameters, status]);
        callback(status);
      }, this));
    },
    
    _mockJoin: function (paramMap, callback) {
      var status = 200;
      var response = {
        sessionId: this.element.attr('id') + '-' + hex_md5(String(Math.random() * 10000)),
        algorithm: "dmp",
        revisionNumber: 0,
        content: '',
        contentType: "text/html;editor=CKEditor",
        properties: {},
        extensions: {}
      };
      
      // TODO: paramMap.algorithm
      // TODO: paramMap.protocolVersion
      
      callback(status, response, null);
    },
    
    _mockUpdate: function (paramMap, callback) {
      $('#server').TestServer('updates', paramMap.revisionNumber, $.proxy(function (status, patches) {
        callback(status, patches, null);
      }, this));
    },

    _onUpdateClick: function (event) {
      event.preventDefault();
      this._editor.checkUpdates();
    },
    
    _destroy : function() {
    }
  });
  
  $.widget("custom.TestServer", {
    options: {
      revision: 0,
      content: ''
    },
    _create : function() {
      this._revisions = [];
      
      this.element.append($('<div>').append($('<label>').text('Revision')));
      this.element.append($('<input>').addClass('ck-rev').attr({"autocomplete": "off"}).val(this.options.revision));
      this.element.append($('<div>').append($('<label>').text('Content')));
      this.element.append($('<textarea>').addClass('ck-content').attr({"autocomplete": "off"}).css({ width: '100%' }).val(this.options.content));
    },
    
    content: function () {
      return this.element.find('.ck-content').val();
    },
    
    revision: function () {
      return parseInt(this.element.find('.ck-rev').val(), 10);
    },
    
    properties: function () {
      return {};
    },

    extensions: function () {
      return {};
    },
    
    patch: function (sessionId, revisionNumber, patch, properties, extensions, callback) {
      if (this.revision() === revisionNumber) {
        var patchRevision = revisionNumber + 1;
        
        if (patch) {
          this._dmpPatch(patch, this.content(), this.properties(), properties, $.proxy(function (err, patched) {
            $('.ck-rev').val(patchRevision);
            $('.ck-content').val(patched);
            
            this._revisions.push({
              revisionNumber: patchRevision,
              patch: patch,
              checksum: hex_md5(patched),
              sessionId: sessionId,
              properties: properties,
              extensions: extensions
            });
            
            callback(err ? 500 : 204);
          }, this));
        } else {
          this._revisions.push({
            revisionNumber: patchRevision,
            patch: null,
            checksum: null,
            sessionId: sessionId,
            properties: properties,
            extensions: extensions
          });
          
          $('.ck-rev').val(patchRevision);
          callback(204);
        }
      } else {
        callback(409);
      }
    },
    
    updates: function (revisionNumber, callback) {
      var result = [];
      for (var i = 0, l = this._revisions.length; i < l; i++) {
        if (this._revisions[i].revisionNumber > revisionNumber) {
          result.push(this._revisions[i]);
        }
      }
      
      if (result.length === 0) {
        callback(204);
      } else {
        callback(200, result);
      }
      
      return result;
    },
    
    _dmpPatch: function (patch, text, fileProperties, patchProperties, callback) {
      var diffMatchPatch = new diff_match_patch();
      
      var patchApplied = true;
      var patches = diffMatchPatch.patch_fromText(patch);
      var result = diffMatchPatch.patch_apply(patches, text);
      for (var j = 0, jl = result[1].length; j < jl; j++) {
        if (result[1][j] === false) {
          patchApplied = false;
        }
      }
      
      if (patchApplied) {
        callback(null, result[0], patchProperties);
      } else {
        callback("Could not apply patch", null, null);
      }
    },
    
    _destroy : function() {
    }
  });
  
  $(document).ready(function (event) {
    $('#server').TestServer();
    $('#ck1').TestCK();
    $('#ck2').TestCK();
  });
  

}).call(this);