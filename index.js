//
// (pre)compile/render mustache templates with hogan
// Can be used as middleware or broadway plugin
//
// common options {
//   debug:Boolean - show log messages
//   cache:Object - use your own cache object
//   hoganOptions:Object - options for hoganjs
//   noFileCheck:Boolean - dont check file for changes
// }
//

var hogan = require('hogan.js'),
    fs = require('fs'),
    path = require('path'),
    url = require('url'),
    utile = require('utile'),
    async = require('async'),
    winston = require('winston');

//
// cache for compiled templates
//
var objCache = {};
// for compiled template src strings
var srcCache = {};

//
// exports
//
// broadway plugin
exports.plugin = {
  name: 'hoganyam',
  attach: attach
};
// connect-style middleware function
exports.provide = provide;

exports.render = render;


//
// return a connect-style middleware function that writes the source
// of the precompiled template to the response object
//
// @srcDir absolute path to templates
// @options {
//   namespace:String - namespace for precompiled templates, default is 'templates'
//   prefixpath:String - virtual base path to request templates from
//   ext:String - template extension, default is '.html'
// }
function provide(srcDir, options) {
  options = options || {};
  options.cache = options.cache || srcCache;
  options.namespace = options.namespace || 'templates';
  options.hoganOptions = options.hoganOptions || {};
  options.hoganOptions.asString = true;
  options.processTemplate = createTemplateSource;
  options.ext = options.ext || '.html';

  var dstExt = /\.js$/,
      srcExt = options.ext;

  return function compileAndSend(req, res, next) {
    if (req.method !== 'GET') return next();

    // build an absolute path
    var pathname = url.parse(req.url).pathname,
        opts = utile.clone(options), // clone to avoid async race
        parts, srcFile;

    if (!pathname.match(dstExt)) return next();

    // remove the prefixpath if there is one
    parts = pathname.split('/');
    if (opts.prefixpath) {
      if (parts[1] !== opts.prefixpath) return next();
      pathname = '/' + parts.slice(2, parts.length).join('/');
    }
    srcFile = path.join(srcDir, pathname).replace(dstExt, srcExt);

    opts.cacheKey = srcFile;
    winston.info('setting cachekey to: ' + srcFile);
    getTemplate(srcFile, opts, function(err,t) {
      if (err) return next(err);
      res.setHeader('Date', new Date().toUTCString());
      res.setHeader('Last-Modified', t.mtime.toUTCString());
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Content-Length', t.template.length);
      res.end(t.template);
    });
  };
}


//
// plugin attach function flatiron.broadway-style
// @options see file header
//
function attach(options) {
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
  options.cache = options.cache || objCache;
  options.cacheKey = file;
  options.hoganOptions = options.hoganOptions || {};

  getTemplate(file, options, function(err, t) {
    callback(err, t ? t.template.render(context, t.partials) : err.message);
  });
}


//
// get the template from file or cache
//
function getTemplate(file, options, callback) {
  if (options.noFileCheck && options.cache && options.cache[options.cacheKey]) {
    winston.verbose('get template from cache with no filecheck: ' + options.cacheKey);
    return callback(null, options.cache[options.cacheKey]);
  }
  findfilep(file, function(err, foundfile) {
    if (err) return callback(err);
    fs.stat(foundfile, function(err, stats) {
      if (err) return callback(err);

      // use the cached version if it exists and is recent enough
      var c = options.cache[options.cacheKey],
          ext, dir;
      if (c && stats.mtime.getTime() <= c.mtime.getTime()) {
        winston.verbose('get template from cache: ' + options.cacheKey);
        return callback(null, c);
      }

      winston.verbose('compile template: ' + file);
      compile(foundfile, options, function(err, t) {
        if (err) return callback(err);
        if (options.processTemplate) options.processTemplate(t, options);
        t.mtime = stats.mtime;
        options.cache[options.cacheKey] = t;
        callback(null, t);
      });
    });
  });
}


//
// compile template - passes a template object to the callback
//
// {
//   template:Function,
//   partials:Dict of partial Functions
// }
function compile(file, options, callback) {
  var ext = path.extname(file),
      dir = path.dirname(file);

  // compile the template file and all partials recusively
  hoganCompile(file, options, function(err, tmpl, partialNames) {
    if (err) return callback(err);

    tmpl.name = path.basename(file, ext);

    async.forEach(partialNames,
                  function(name, cb) {
                    var pfile = path.join(dir, name + ext),
                        poptions = utile.clone(options);
                    poptions.cacheKey = pfile;

                    getTemplate(pfile, poptions, function(err, t) {
                      if (err) return cb(err);
                      tmpl.partials[name] = t.template;
                      // _.extend(tmpl.partials, t.partials);
                      tmpl.partials = utile.mixin(tmpl.partials, t.partials);
                      cb();
                    });
                  },
                  function(err) {
                    callback(err, tmpl);
                  });
  });
}


// compiles the template and extracts names of the partials
function hoganCompile(file, options, callback) {
  fs.readFile(file, 'utf8', function(err, str) {
    if (err) return callback(err);
    // let hogan scan the src into tokens and collect all of the partial names
    // partial tokens have the tag: '>'
    var tokens = hogan.scan(str),
        // partialTokens = _.filter(tokens, function(t) {
        //   return t.tag === '>';
        // }),
        // partialNames = _.map(partialTokens, function(t) {
        //   return t.n;
        // }),
        partialNames = tokens
                       .filter(function(t) { return t.tag === '>'; })
                       .map(function(t) { return t.n; }),
        hgopts = options.hoganOptions,
        tmpl = {};

    // compile the tokens
    tmpl.template = hogan.generate(hogan.parse(tokens, str, hgopts), str, hgopts);
    tmpl.partials = {};
    callback(err, tmpl, partialNames);
  });
}


//
// transform template property of template object to proper js source
// client can render template by calling
// [namespace].[name].render(context);
//
function createTemplateSource(t, options) {
  var str = '',
      p;

  str += ';(function(root) {\n';
  str += '\troot.' + t.name + ' = {\n';

  str += '\t\ttemplate: new Hogan.Template(' + t.template + '),\n';
  str += '\t\tpartials: {\n';
  for (p in t.partials) {
    str += '\t\t\t' + p + ': new Hogan.Template(' + t.partials[p] + '),\n';
  }
  str += '\t\t},\n';
  str += '\t\trender: function(context){\n';
  str += '\t\t\treturn this.template.render(context, this.partials);\n';
  str += '\t\t}\n';

  str += '\t};\n';
  str += '})( this.' + options.namespace + ' || this);\n';

  if (options.debug) str += 'console.log("template: ' + t.name + ' loaded");\n';

  if (options && options.compress) {
    var jsp = require("uglify-js").parser,
        pro = require("uglify-js").uglify,
        ast = jsp.parse(str); // parse code and get the initial AST
    ast = pro.ast_mangle(ast); // get a new AST with mangled names
    ast = pro.ast_squeeze(ast); // get an AST with compression optimizations
    str = pro.gen_code(ast); // compressed code here
  }

  // t.partials = null;
  t.template = str;
  return t;
}


//
// find a file by walking up the path
//
function findfilep(pathname, callback) {
  var basename = path.basename(pathname),
      dirname = path.dirname(pathname);

  path.exists(pathname, function(exists) {
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
