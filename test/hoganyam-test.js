var vows = require('vows'),
    assert = require('assert'),
    vm = require('vm'),
    hoganyam = require('../index.js'),
    hogan = require('hogan.js'),
    path = require('path'),
    fs = require('fs'),
    srcDir = path.join(__dirname, 'data'),
    testFile = path.join(srcDir, 'test.template'),
    options = {},
    data = { title: "a little test", name: "Hogan"},
    resultStr = "This is " + data.title + " for Mr. " + data.name + '.';


vows.describe('hoganyam').addBatch({
  "The hoganyam module": {
    topic: hoganyam,
    "should have the correct methods defined": function() {
      assert.isObject(hoganyam);
      assert.isFunction(hoganyam.provide);
      assert.isFunction(hoganyam.providePacked);
      assert.isFunction(hoganyam.render);
      assert.isObject(hoganyam.plugin);
    },
    "rendering the test template": {
      topic: function() {
        hoganyam.render(testFile, data, options, this.callback);
      },
      "is showing the correct output": function(str) {
        assert.equal(str, resultStr);
      }
    },
    "used as middleware for single template": {
      topic: function() {
        var self = this,
            next = self.callback,
            req = {
              method: 'GET',
              url: 'test.js'
            },
            res = {
              setHeader: function() {},
              end: function(str) { self.callback(null, str); }
            };
        hoganyam.provide(srcDir, {ext: '.template'})(req, res, next);
      },
      "provides the correct source js template function ": function(str) {
        var templates = {},
            sandbox = {
              Hogan: hogan,
              result: null
            },
            context = vm.createContext(sandbox);
        str += 'result = test.render(' + JSON.stringify(data) + ');\n';
        vm.runInContext(str, context);
        assert.equal(context.result, resultStr);
      }
    },
    "used as middleware for multiple templates": {
      topic: function() {
      }
    }
  }
}).export(module);