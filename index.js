//
// (pre)compile/render mustache templates with hogan.js
// can be used as middleware or broadway plugin
//

var hogan = require('hogan.js'),
    fs = require('fs'),
    path = require('path'),
    url = require('url'),
    utile = require('utile'),
    async = require('async'),
    winston = require('winston');

//
// exports
//

// broadway plugin
exports.plugin = {
  name: 'hoganyam',
  attach: function(options) {
    options.cache = options.cache || {};
    this.render = function(res, name, context) {
      context = context || {};
      var file = path.join(options.dir, name + options.ext);
      render(file, context, options, function(err, str) {
        if (err) {
          winston.error(err);
          res.writeHead(200, {'Content-Type': 'text/plain'});
          res.end(err.toString());
        } else {
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end(str);
        }
      });
    };
  }
};

// provide templates from a directory individually as connect-style middleware
exports.provide = provide;

// bundle templates form a directory into one js-file as connect-style middleware
exports.bundle = bundle;

// render a template
exports.render = render;



//
// provide compiled templates individually through url
// connect-style middleware function
//
// @srcDir absolute path to templates
// @srcUrl base url for request
// @options {
//   namespace namespace for precompiled templates, default is 'templates'
//   ext template extension, default is '.html'
//   hoganOptions options for the hogan.js template engine
// }
//
function provide(srcDir, options) {
  options = options || {};
  options.ext = options.ext || '.html';
  options.mount = options.mount || '';
  options.namespace = options.namespace || 'this';
  options.hoganOptions = options.hoganOptions || {};
  options.hoganOptions.asString = true;

  var dstExt = /\.js$/,
      srcExt = options.ext,
      cache = options.cache || {},
      jsTemplate,
      jst = '';

  jst += ';(function(root) {\n';
  jst += '  var template = new Hogan.Template({{{template}}});\n';
  jst += '  var partials = {\n';
  jst += '    {{#partials}}';
  jst += '      "{{name}}": new Hogan.Template({{{template}}}),\n';
  jst += '    {{/partials}}';
  jst += '  };\n';
  jst += '  root.templates["{{name}}"] = function(context) {\n';
  jst += '    return template.render(context, partials);\n';
  jst += '  };\n';
  jst += '})({{namespace}});\n';
  jsTemplate = hogan.compile(jst);

  return function compileAndSend(req, res, next) {
    if (req.method !== 'GET') return next();

    // build an absolute path
    var pathname = url.parse(req.url).pathname,
        srcFile, src, ux;

    if (!pathname.match(dstExt)) return next();
    if (options.mount) {
      ux = new RegExp('^' + options.mount);
      if (!pathname.match(ux)) return next();
      // remove prefix url and leading slashes
      pathname = pathname.replace(ux, '').replace(/^\/*/, '');
    }
    srcFile = path.join(srcDir, pathname).replace(dstExt, srcExt);

    if (!options.recompile && cache[srcFile]) {
      winston.verbose('providing template from cache: ', srcFile);
      sendResponse(res, cache[srcFile].source, cache[srcFile].mtime.toUTCString());
    }
    else {
      getTemplate(srcFile, options, function(err,t) {
        if (err) return next(err);
        var name = createTemplateName(srcDir, srcFile, options.ext),
            context = {
              name: name,
              template: t.template,
              partials: [],
              namespace: options.namespace
            };
        utile.each(t.partials, function(v, k) {
          context.partials.push({
            name: k,
            template: v
          });
        });
        src = jsTemplate.render(context);
        if (!options.recompile) {
          cache[srcFile] = { source: src, mtime: t.mtime };
        }
        sendResponse(res, src, t.mtime.toUTCString());
      });
    }
  };
}

//
// bundle all compiled templates into one js file
//
// @srcDir directory with templates
// @options {
//   @namespace namespace for precompiled templates, default is 'templates'
//   @ext template extension, default is '.html'
//   @hoganOptions options for the hogan.js template engine
// }
//
function bundle(srcDir, options) {
  options = options || {};
  options.mount = options.mount || '/templates.js';
  options.ext = options.ext || '.html';
  options.namespace = options.namespace || 'this';
  options.hoganOptions = options.hoganOptions || {};
  options.hoganOptions.asString = true;

  var jsTemplate = createTemplate();

  function createTemplate() {
    var jst = '';
    jst += '// autogenerated file\n';
    jst += ';(function(root){\n';
    jst += '  var templates = {\n';
    jst += '  {{#templates}}\n';
    jst += '    "{{name}}": new Hogan.Template({{{template}}}),\n';
    jst += '  {{/templates}}\n';
    jst += '  };\n';
    jst += '  var renderers = {\n';
    jst += '  {{#templates}}\n';
    jst += '    "{{name}}": function(context) {\n';
    jst += '      return templates["{{name}}"].render(context, templates)\n';
    jst += '    },\n';
    jst += '  {{/templates}}\n';
    jst += '  };\n';
    jst += '  root.templates = renderers;\n';
    jst += '})({{namespace}});\n';
    return hogan.compile(jst);
  }

  return function compileAndSend(req, res, next) {
    if (req.method !== 'GET') return next();

    var reqUrl = url.parse(req.url).pathname,
        src = '';

    // only answer correct url
    if (reqUrl !== options.mount) return next();

    compileDir(srcDir, options, function(err, templates) {
      winston.verbose("compiling template dir: ", srcDir);
      if (err) return next(err);

      resolvePartialNames(templates);
      src = jsTemplate.render({ templates: templates, namespace: options.namespace});

      sendResponse(res, src);
    });
  };
}


//
// resolve partial name like '../header' to qualified template name
// @templates dict with templates
//
function resolvePartialNames(templates) {
  templates.forEach(function(template) {
    var parts = template.name.split(path.sep),
        basePath = parts.length === 1 ? '' : parts.slice(0, parts.length - 1).join(path.sep);

    template.partials = template.partials.map(function(partialName) {
      return path.join(basePath, partialName);
    });
  });
}


function createTemplateName(basePath, filePath, ext) {
  var len = basePath.split(path.sep).length,
      relPath = filePath.split(path.sep).slice(len).join(path.sep),
      name = relPath.replace(new RegExp(ext + '$'), '');
  return name;
}


function sendResponse(res, str, mtime) {
  res.setHeader('Date', new Date().toUTCString());
  res.setHeader('Last-Modified', mtime || (new Date).toUTCString());
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Content-Length', str.length);
  res.end(str);
}


//
// render a template file with context mapping
//
// @file absolute path to the file
// @context vars to map
// @options see file header
// @callback is called with (err, str)
//
function render(file, context, options, callback) {
  winston.verbose('rendering: ' + file);
  options = options || {};
  options.cache = options.cache || {};
  options.hoganOptions = options.hoganOptions || {};

  var key = file,
      ct = options.cache[key];

  if (!options.recompile && ct) {
    winston.verbose('render template from cache: ' + file);
    callback(null, ct.template.render(context, ct.partials));
  }
  else {
    getTemplate(file, options, function(err, t) {
      if (!options.recompile) options.cache[key] = t;
      callback(err, t ? t.template.render(context, t.partials) : err.message);
    });
  }
}


//
// get the template file and compile it
//
function getTemplate(file, options, callback) {
  winston.verbose('getting template: ' + file);
  findfilep(file, function(err, foundfile) {
    if (err) return callback(err);
    fs.stat(foundfile, function(err, stats) {
      if (err) return callback(err);
      var ext, dir;
      compile(foundfile, options, function(err, t) {
        if (err) return callback(err);
        // if (options.processTemplate) options.processTemplate(t, options);
        t.mtime = stats.mtime;
        callback(null, t);
      });
    });
  });
}


//
// compile template and partials
//
function compile(file, options, callback) {
  var ext = path.extname(file),
      dir = path.dirname(file);

  // compile the template
  hoganCompile(file, options.hoganOptions, function(err, template, partialNames) {
    if (err) return callback(err);
    var tmpl = {
      template: template,
      name: path.basename(file, ext),
      partials: {}
    };
    // compile the partials
    async.forEach(partialNames,
                  function(name, cb) {
                    var pfile = path.join(dir, name + ext),
                        poptions = utile.clone(options);

                    getTemplate(pfile, poptions, function(err, t) {
                      if (err) return cb(err);
                      tmpl.partials[name] = t.template;
                      tmpl.partials = utile.mixin(tmpl.partials, t.partials);
                      cb();
                    });
                  },
                  function(err) {
                    callback(err, tmpl);
                  });
  });
}


//
// compile template files in the directory and all subdirectories asynchronously
// @basePath base path
// @options
// @callback call when finished
//
function compileDir(basePath, options, callback) {
  // options = options || {};
  // options.ext = options.ext || '.html';
  // options.hoganOptions = options.hoganOptions || {};

  var templates = [],
      compileIterator = function(filePath, callback) {
        if (!filePath.match(new RegExp(options.ext + '$'))) {
          return;
        }
        hoganCompile(filePath, options.hoganOptions, function(err, template, partialNames) {
          if (err) return callback(err);
          // var len = basePath.split(path.sep).length,
          //     relPath = filePath.split(path.sep).slice(len).join(path.sep),
          //     name = relPath.replace(/.html$/, '');
          templates.push({
            name: createTemplateName(basePath, filePath, options.ext),
            template: template,
            partials: partialNames
          });
          callback();
        });
      };

  eachFileInDir(basePath,
                compileIterator,
                function(err) {
                  callback(err, templates);
                });
}


//
// compiles the template and extracts partial names
// @file the template file
// @options hogan options
// @callback is called when finished
//
function hoganCompile(file, options, callback) {
  fs.readFile(file, 'utf8', function(err, str) {
    if (err) return callback(err);
    // let hogan scan the src into tokens and collect all of the partial names
    // partial tokens have the tag: '>'
    var tokens = hogan.scan(str),
        partialNames = tokens
                       .filter(function(t) { return t.tag === '>'; })
                       .map(function(t) { return t.n; }),
        template = hogan.generate(hogan.parse(tokens, str, options), str, options);
    callback(err, template, partialNames);
  });
}


//
// find a file by walking up the path
//
function findfilep(pathname, callback) {
  var basename = path.basename(pathname),
      dirname = path.dirname(pathname);

  fs.exists(pathname, function(exists) {
    if (!exists && dirname === '/') {
      return callback(new Error('Cannot find file: ' + basename));
    }
    else if (!exists) {
      var parentpath = path.join(path.resolve(dirname, '..'), basename);
      findfilep(parentpath, callback);
    }
    else {
      callback(null, pathname);
    }
  });
}


//
// call iterator on all files in the path and subpaths asynchronously
// @startPath base path
// @iterator iterator function(filePath, callback) {}
// @callback call when finished
//
function eachFileInDir(startPath, iterator, callback) {
  (function rec(basePath, callback) {
    fs.stat(basePath, function(err, stats) {
      if (err) return callback(err);
      if (stats.isFile()) {
        iterator(basePath, callback);
      }
      else if (stats.isDirectory()) {
        fs.readdir(basePath, function(err, nodes) {
          if (err) return callback(err);
          utile.async.forEach(nodes,
                              function(node, callback) {
                                rec(path.join(basePath, node), callback);
                              },
                              callback);
        });
      }
    });
  })(startPath, callback);
}
