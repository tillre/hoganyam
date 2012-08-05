var vows = require('vows'),
    assert = require('assert'),
    vm = require('vm'),
    hoganyam = require('../index.js'),
    hogan = require('hogan.js'),
    path = require('path'),
    fs = require('fs'),
    dataDir = path.join(__dirname, 'data'),
    testFile = path.join(dataDir, 'test.template'),
    options = {},
    data = { title: "a little test", name: "Hogan"},
    correctResult = fs.readFileSync(path.join(dataDir, 'result.txt')).toString();

function puts(str) {
  process.stderr.write(str + '\n');
}

function mockReq(url) {
  return {
    method: 'GET',
    url: url
  };
}

function mockRes(callback) {
  return {
    setHeader: function() {},
    end: function(str) { callback(null, str); }
  };
}

function evalTemplate(templateStr, callStr, data) {
  var str = templateStr + 'result = ' + callStr + '(' + JSON.stringify(data) + ');\n',
      sandbox = {
        Hogan: hogan,
        result: null
      },
      context = vm.createContext(sandbox);
  vm.runInContext(str, context);
  return context.result;
}

vows.describe('hoganyam').addBatch({
  "The hoganyam module": {
    topic: hoganyam,
    "should have the correct methods defined": function() {
      assert.isObject(hoganyam);
      assert.isFunction(hoganyam.provide);
      assert.isFunction(hoganyam.bundle);
      assert.isFunction(hoganyam.render);
      assert.isObject(hoganyam.plugin);
    },
    "rendering the test template": {
      topic: function() {
        hoganyam.render(testFile, data, options, this.callback);
      },
      "should show the correct output": function(str) {
        assert.equal(str, correctResult);
      }
    },
    "used as middleware for single template": {
      topic: function() {
        var f = hoganyam.provide(dataDir, {ext: '.template'}),
            that = this;
        f(mockReq('test.js'), mockRes(this.callback), function(err) {
          that.callback(err || new Error('request failed'));
        });
      },
      "sould provide the compiled template and render the correct result": function(err, str) {
        assert.isNull(err);
        var result = evalTemplate(str, 'templates.test', data);
        assert.equal(result, correctResult);
      }
    },

    "used as middleware for bundled templates": {
      topic: function() {
        var that = this,
            f = hoganyam.bundle(dataDir, {ext: '.template'});

        f(mockReq('/templates.js'), mockRes(this.callback), function(err) {
          that.callback(err || new Error('request failed'));
        });
      },
      "should bundle the compiled templates and render the correct result": function(err, str) {
        assert.isNull(err);
        // puts(str);
        var result = evalTemplate(str, 'templates.test', data);
        assert.equal(result, correctResult);
      }
    }
  }
}).export(module);