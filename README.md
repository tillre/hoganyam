# hoganyam
Yet another hogan.js(moustache templates) middleware. Can render templates with partials serverside or precompile them for use on the client. The templates are compiled, cached and updated when the file changes.

## Usage
``` js
    var hoganyam = require('hoganyam');
```

### As connect-style middleware

``` js
    app.use(hoganyam.provide(templatesDir, options))
```

### Serverside rendering

``` js
    hoganyam.render(file, context, options, function(err, str) {
        // do something with the rendered template string
    });
```

**Use as broadway plugin for flatiron**
``` js
    app.use(hoganyam.plugin, {dir: viewsDir, ext: app.config.get('.html')});
    // now you render directly to the response
    app.render(res, 'templatename', { title: 'Hello Hogan'});
```

**For options see source**

## License
MIT License

## Install with npm
    npm install hoganyam

## Run tests
    npm test