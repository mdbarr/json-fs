#!/usr/bin/env node
'use strict';

require('barrkeep');
const fs = require('fs');
const url = require('url');
const http = require('http');
const path = require('path');
const querystring = require('querystring');

const EventEmitter = require('events');

//////////
// Shims

Object.defineProperty(String.prototype, 'stripWhitespace', {
  value() {
    return this.replace(/\s/g, '');
  },
  enumerable: false,
  configurable: true
});

Object.$resolve = function(object, propertyPath) {
  if (!object || !propertyPath) {
    return undefined;
  }

  console.log('resolve', propertyPath);
  const parts = propertyPath.stripWhitespace().split(/[./]/);

  if (!object) {
    return undefined;
  }

  for (const part of parts) {
    object = object[part];
    if (!object) {
      return undefined;
    }
  }
  return object;
};

Object.$set = function(object, propertyPath, value) {
  const parts = propertyPath.stripWhitespace().split(/\./);
  const key = parts.pop();

  for (const part of parts) {
    object = object[part];

    if (!object) {
      return false;
    }
  }

  object[key] = value;

  return true;
};

Object.$flatten = function(object, prefix = '', container = {}) {
  if (typeof object !== 'object') {
    container[prefix] = object;
    return container;
  }

  if (prefix.length) {
    prefix += '.';
  }

  for (const key in object) {
    const pathKey = prefix + key;

    if (Array.isArray(object[key])) {
      container[`${ pathKey }$type`] = 'Array';
      const array = object[key];
      for (let i = 0; i < array.length; i++) {
        Object.$flatten(array[i], `${ pathKey }.${ i }`, container);
      }
    } else if (typeof object[key] === 'object' && object[key] !== null) {
      container[`${ pathKey }$type`] = 'Object';
      Object.$flatten(object[key], pathKey, container);
    } else {
      container[ pathKey ] = object[key];
    }
  }
  return container;
};

Object.$expand = function(container, object = {}) {
  for (const key in container) {
    const parts = key.split(/\./);
    const property = parts.pop();

    let chunk = object;
    for (const part of parts) {
      if (!chunk[part]) {
        chunk[part] = {};
      }

      chunk = chunk[part];
    }

    if (property.endsWith('$type')) {
      const name = property.replace(/\$type$/, '');
      if (container[key] === 'Object') {
        chunk[name] = {};
      } else if (container[key] === 'Array') {
        chunk[name] = [];
      } else {
        // Unknown type
      }
    } else {
      chunk[property] = container[key];
    }
  }
  return object;
};

querystring.$setTypes = function(object) {
  for (const key in object) {
    const value = object[key];

    if (parseInt(value, 10).toString() === value) {
      object[key] = parseInt(value, 10);
    } else if (parseFloat(value, 10).toString() === value) {
      object[key] = parseFloat(value, 10);
    } else if (value === 'true') {
      object[key] = true;
    } else if (value === 'false') {
      object[key] = false;
    }
  }
  return object;
};

//////////
// Event handling and Proxy

const events = new EventEmitter();

const interceptor = function(object, eventName) {
  const intercept = {
    get(target, key) {
      if (typeof target[key] === 'object' && target[key] !== null) {
        return new Proxy(target[key], intercept);
      }
      return target[key];
    },
    set(target, key, value) {
      target[key] = value;
      events.emit(eventName, target, key, value);
      return true;
    }
  };

  return new Proxy(object, intercept);
};

//////////
// Loader

const mapFile = process.argv[2];
if (!mapFile) {
  console.log('No Map File');
  process.exit(1);
}

const mapping = JSON.parse(fs.readFileSync(mapFile));
const directory = path.dirname(mapFile);

for (const mount in mapping.mounts) {
  const filename = path.join(directory, mapping.mounts[mount]);
  const json = JSON.parse(fs.readFileSync(filename));

  events.on(mount, (target, key, value) => {
    //fs.writeFile(filename, JSON.stringify(json, null, 2));
    console.log(`Change detected for ${ mount }: ${ key } = ${ value }`);
  });

  mapping.mounts[mount] = interceptor(json, mount);
}

//////////
// Map

function generateMapping(object) {
  const container = {};

  for (const property in object) {
    if (typeof object[property] === 'string') {
      container[property] = object[property];
    } else if (typeof object[property] === 'object') {
      container[property] = generateMapping(object[property]);
    }
  }

  return container;
}

function generateBinding(object) {
  const map = generateMapping(object);

  const intercept = {
    get(target, key) {
      if (typeof target[key] === 'object' && target[key] !== null) {
        return new Proxy(target[key], intercept);
      }
      return Object.$resolve(mapping.mounts, target[key]);
    },
    set(target, key, value) {
      return Object.$set(mapping.mounts, target[key], value);
    }
  };

  return new Proxy(map, intercept);
}

//////////
// Tree creation

const tree = generateBinding(mapping.map);

//////////
// Simple tests
//console.pp(tree);
//tree.text.image = 'crap';
//console.pp(tree);
//tree.text.labels['com.example.license'] = 'MIT';
//console.pp(tree);
//const flat = Object.$flatten(mapping.mounts);
//console.pp(flat);
//const expand = Object.$expand(flat);
//console.pp(expand);

//////////
// Render objects to given depth

function render(object, maxDepth = 1, depth = 0) {
  const container = {};

  if (maxDepth !== -1 && depth >= maxDepth) {
    return container;
  }

  if (typeof object !== 'object') {
    return object;
  }

  for (const key in object) {
    if (Array.isArray(object[key])) {
      container[key] = [];
      for (let item of object[key]) {
        item = render(item, maxDepth, depth + 1);
        container[key].push(item);
      }
    } else if (typeof object[key] === 'object' && object[key] !== null) {
      const item = render(object[key], maxDepth, depth + 1);
      container[key] = item;
    } else {
      container[key] = object[key];
    }
  }
  return container;
}

//////////
// Server creation

const port = 3800;

const server = http.createServer((request, response) => {
  let data = '';

  response.send = function(object) {
    const content = JSON.stringify(object, null, 2);

    response.setHeader('Content-Type', 'application/json');
    response.write(content);
    response.end();
  };

  request.on('data', (chunk) => { data = data + chunk; });

  request.on('end', () => {
    const method = request.method.toLowerCase();
    const parsed = url.parse(request.url);

    const query = querystring.parse(parsed.query);
    querystring.$setTypes(query);

    let body = {};
    try {
      body = JSON.parse(data);
    } catch (exc) {
      // no error
    }

    console.pp(method);
    console.pp(parsed);
    console.pp(query);

    const pathname = parsed.pathname.replace(/^\/+/, '').replace(/\/+/g, '/');

    if (method === 'get') {
      const object = pathname ? Object.$resolve(tree, pathname) : tree;
      const result = render(object, query.depth || 1);

      return response.send(result);
    } else if (method === 'post') {
      const object = pathname ? Object.$resolve(tree, pathname) : tree;
      const update = Object.$flatten(body);

      console.pp(update);

      Object.assign(object, body);

      return response.send(object);
    }

    return response.send({});
  });
});

server.listen(port, () => {
  console.log(`JSON-FS listening on http://0.0.0.0:${ port }`);
});
