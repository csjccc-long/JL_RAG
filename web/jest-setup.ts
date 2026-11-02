import '@testing-library/jest-dom';
import React from 'react';
import { TextDecoder, TextEncoder } from 'node:util';

require('whatwg-fetch');

// Keep React available for test helpers that still use the classic JSX runtime.
(globalThis as Record<string, unknown>).React = React;

Object.assign(globalThis, { TextDecoder, TextEncoder });
