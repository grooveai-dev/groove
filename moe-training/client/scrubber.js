// FSL-1.1-Apache-2.0 — see LICENSE

function luhnCheck(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export class PIIScrubber {
  constructor() {
    this._patterns = [
      {
        name: 'pem_private_key',
        regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
        replacement: '[PRIVATE_KEY]',
      },
      {
        name: 'aws_key',
        regex: /AKIA[0-9A-Z]{16}/g,
        replacement: '[AWS_KEY]',
      },
      {
        name: 'jwt_token',
        regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
        replacement: '[API_KEY]',
      },
      {
        name: 'bearer_token',
        regex: /Bearer\s+[A-Za-z0-9._~+/\-]+=*/g,
        replacement: '[API_KEY]',
      },
      {
        name: 'sk_pk_key',
        regex: /(?:sk|pk)_[a-zA-Z0-9_]{20,}/g,
        replacement: '[API_KEY]',
      },
      {
        name: 'credit_card',
        regex: /\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g,
        replacement: null, // handled in scrub() with Luhn
      },
      {
        name: 'ssn',
        regex: /\b\d{3}-\d{2}-\d{4}\b/g,
        replacement: '[SSN]',
      },
      {
        name: 'email',
        regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
        replacement: '[EMAIL]',
      },
      {
        name: 'email_urlencoded',
        regex: /[a-zA-Z0-9._%+-]+%40[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: '[EMAIL]',
      },
      {
        name: 'ipv6',
        regex: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|::(?:[fF]{4}:)?(?:\d{1,3}\.){3}\d{1,3}|::1\b/g,
        replacement: '[IP]',
      },
      {
        name: 'ipv4',
        regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
        replacement: '[IP]',
      },
      {
        name: 'intl_phone',
        regex: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?/g,
        replacement: '[PHONE]',
      },
      {
        name: 'phone',
        regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        replacement: '[PHONE]',
      },
      {
        name: 'url_with_secret',
        regex: /https?:\/\/[^\s]*[?&](?:token|key|secret|password|api_key|apikey|access_token|auth)=[^\s&]*/gi,
        replacement: '[REDACTED_URL]',
      },
      {
        name: 'long_hex',
        regex: /\b[0-9a-fA-F]{40,}\b/g,
        replacement: '[API_KEY]',
      },
      {
        name: 'home_path',
        regex: /(?:\/Users\/[^\/\s]+|\/home\/[^\/\s]+|C:\\Users\\[^\\\s]+)([\/\\][^\s]*)?/g,
        replacement: null,
      },
      {
        name: 'base64_secret',
        regex: /(?<![A-Za-z0-9+])[A-Za-z0-9+]{40,}={0,2}(?![A-Za-z0-9+])/g,
        replacement: '[API_KEY]',
      },
    ];
  }

  scrub(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;

    for (const pattern of this._patterns) {
      if (pattern.name === 'credit_card') {
        result = result.replace(pattern.regex, (match, g1, g2, g3, g4) => {
          const digits = (g1 + g2 + g3 + g4);
          return luhnCheck(digits) ? '[CREDIT_CARD]' : match;
        });
      } else if (pattern.name === 'home_path') {
        result = result.replace(pattern.regex, (_match, relPath) => '~' + (relPath || ''));
      } else {
        result = result.replace(pattern.regex, pattern.replacement);
      }
    }

    return result;
  }
}
