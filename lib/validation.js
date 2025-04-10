'use strict';

const { isUtf8 } = require('buffer');

const { hasBlob } = require('./constants');

//
// Allowed token characters:
//
// '!', '#', '$', '%', '&', ''', '*', '+', '-',
// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
//
// tokenChars[32] === 0 // ' '
// tokenChars[33] === 1 // '!'
// tokenChars[34] === 0 // '"'
// ...
//
// prettier-ignore
const tokenChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
];

/**
 * Checks if a status code is allowed in a close frame.
 *
 * @param {Number} code The status code
 * @return {Boolean} `true` if the status code is valid, else `false`
 * @public
 */
function isValidStatusCode(code) {
  return (
    (code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

/**
 * Checks if a given buffer contains only correct UTF-8.
 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
 * Markus Kuhn.
 *
 * @param {Buffer} buf The buffer to check
 * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
 * @public
 */
function _isValidUTF8(buf) {
  const len = buf.length;
  let i = 0;

  while (i < len) {
    if ((buf[i] & 0x80) === 0) {
      // 0xxxxxxx (ASCII, 1 byte)
      i++;
    } else if ((buf[i] & 0xe0) === 0xc0) {
      // 110xxxxx 10xxxxxx (2 bytes)
      if (i + 1 === len) {
        console.log(`Invalid UTF-8: Incomplete 2-byte sequence at index ${i}`);
        return false;
      }
      if ((buf[i + 1] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Second byte of 2-byte sequence invalid at index ${i + 1}`);
        return false;
      }
      if ((buf[i] & 0xfe) === 0xc0) {
        console.log(`Invalid UTF-8: Overlong 2-byte sequence at index ${i}`);
        return false;
      }
      i += 2;
    } else if ((buf[i] & 0xf0) === 0xe0) {
      // 1110xxxx 10xxxxxx 10xxxxxx (3 bytes)
      if (i + 2 >= len) {
        console.log(`Invalid UTF-8: Incomplete 3-byte sequence at index ${i}`);
        return false;
      }
      if ((buf[i + 1] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Second byte of 3-byte sequence invalid at index ${i + 1}`);
        return false;
      }
      if ((buf[i + 2] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Third byte of 3-byte sequence invalid at index ${i + 2}`);
        return false;
      }
      if (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) {
        console.log(`Invalid UTF-8: Overlong 3-byte sequence at index ${i}`);
        return false;
      }
      if (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) {
        console.log(`Invalid UTF-8: Surrogate in 3-byte sequence at index ${i}`);
        return false;
      }
      i += 3;
    } else if ((buf[i] & 0xf8) === 0xf0) {
      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx (4 bytes)
      if (i + 3 >= len) {
        console.log(`Invalid UTF-8: Incomplete 4-byte sequence at index ${i}`);
        return false;
      }
      if ((buf[i + 1] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Second byte of 4-byte sequence invalid at index ${i + 1}`);
        return false;
      }
      if ((buf[i + 2] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Third byte of 4-byte sequence invalid at index ${i + 2}`);
        return false;
      }
      if ((buf[i + 3] & 0xc0) !== 0x80) {
        console.log(`Invalid UTF-8: Fourth byte of 4-byte sequence invalid at index ${i + 3}`);
        return false;
      }
      if (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) {
        console.log(`Invalid UTF-8: Overlong 4-byte sequence at index ${i}`);
        return false;
      }
      if (buf[i] === 0xf4 && buf[i + 1] > 0x8f) {
        console.log(`Invalid UTF-8: Out of range Unicode value at index ${i}`);
        return false;
      }
      if (buf[i] > 0xf4) {
        console.log(`Invalid UTF-8: Out of range Unicode value (greater than U+10FFFF) at index ${i}`);
        return false;
      }
      i += 4;
    } else {
      console.log(`Invalid UTF-8: Invalid starting byte at index ${i}`);
      return false;
    }
  }

  return true;
}

/**
 * Determines whether a value is a `Blob`.
 *
 * @param {*} value The value to be tested
 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
 * @private
 */
function isBlob(value) {
  return (
    hasBlob &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.type === 'string' &&
    typeof value.stream === 'function' &&
    (value[Symbol.toStringTag] === 'Blob' ||
      value[Symbol.toStringTag] === 'File')
  );
}

module.exports = {
  isBlob,
  isValidStatusCode,
  isValidUTF8: _isValidUTF8,
  tokenChars
};

if (isUtf8) {
  module.exports.isValidUTF8 = function (buf) {
    const result = buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);

    if (!result) {
      console.log('In the first part');
      console.log(`Invalid UTF-8 found in Result1: ${buf.toString('hex')}`);
    }

    return result;
  };
} /* istanbul ignore else  */ else if (!process.env.WS_NO_UTF_8_VALIDATE) {
  try {
    const isValidUTF8 = require('utf-8-validate');

    module.exports.isValidUTF8 = function (buf) {
      

      const result2 = buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);

      if (!result2) {
        console.log(`Invalid UTF-8 found in Result2: ${buf.toString('hex')}`);
      }

      return result2;
    };
  } catch (e) {
    // Continue regardless of the error.
  }
}
