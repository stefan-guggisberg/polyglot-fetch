/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

 'use strict';

 const {
  ClientHttp2Session,
  ClientHttp2Stream,
  connect,
  constants,
  IncomingHttpHeaders,
  SecureClientSessionOptions,
} = require('http2');
const { Readable } = require('stream');

// TODO: idle session timeout: configurable context option
const IDLE_SESSION_TIMEOUT = 5 * 60 * 1000; // 5m

const sessionCache = {};

const createResponse = (headers, clientHttp2Stream) => {
  const statusCode = headers[':status'];
  delete headers[':status'];
  return {
    statusCode,
		httpVersion: '2.0',
		httpVersionMajor: 2,
		httpVersionMinor: 0,
    headers,
    readable: clientHttp2Stream
  };
}

const request = async (ctx, url, options) => {
  const { origin, pathName, search, hash } = url;
  const path = `${pathName || '/'}${search}${hash}`;

  const opts = { ...options };
  const { method, headers = {}, socket, body } = opts;
  if (socket) {
    delete opts.socket;
  }
  if (headers.host) {
    headers[':authority'] = headers.host;
    delete headers.host;
  }

  // lookup session from session cache
  let session = sessionCache[origin];
  if (!session || session.closed) {
    // connect and setup new session
    // TODO: connect options: configurable context option
    const connectOptions = {};	// https://nodejs.org/api/http2.html#http2_http2_connect_authority_options_listener
    if (socket) {
      // reuse socket
      connectOptions.createConnection = (url, options) => socket;
    }
    session = connect(origin, connectOptions);
    // TODO: idle session timeout: configurable context option
    //session.setTimeout(IDLE_SESSION_TIMEOUT);
    session.on('origin', (origins) => {
      origins.forEach((origin) => {
        console.log(`origin: ${origin}`);
      });
    });
    session.once('timeout', () => session.close());
    session.once('close', () => delete sessionCache[origin]);
    session.on('error', (err) => console.error(err)); // TODO: propagate error
    sessionCache[origin] = session;
  } else {
    // we have a cached session 
    if (socket) {
      // we have no use for the passed socket
      socket.destroy();
    }
  }

  return new Promise((resolve, reject) => {
    const req = session.request({ ':method': method, ':path': path, ...headers });
    req.once('response', (headers, flags) => {
      resolve(createResponse(headers, req));
    });
    // send request body?
    if (body instanceof Readable) {
      body.pipe(req);
    } else if (body instanceof Buffer) {
      req.write(body);
    } else if (body) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = request;
