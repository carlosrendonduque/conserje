/**
 * Conserje chat widget.
 *
 * Embedded with one script tag. Everything renders inside a shadow root, so
 * the widget cannot inherit or leak styles, and it adds exactly one element to
 * the host page.
 *
 * It holds no credentials and knows no model: it posts a message plus an
 * opaque session id to the backend and renders whatever comes back.
 *
 *   <script src="conserje.js"
 *           data-endpoint="https://api.example.com/chat"
 *           data-site="carlos-portfolio"
 *           data-greeting="Hola, ¿en qué estás trabajando?"
 *           data-title="Carlos Rendon"
 *           data-accent="#2f6f4f"
 *           defer></script>
 */
(function () {
  'use strict';

  var STYLES = '__CONSERJE_STYLES__';

  var COPY = {
    en: {
      launcher: 'Chat with us',
      subtitle: 'Usually replies in a moment',
      close: 'Close chat',
      placeholder: 'Type your message',
      send: 'Send',
      sending: 'Sending',
      offline: 'Could not reach the assistant.',
      retry: 'Retry',
      failed: 'Something went wrong. Please try again later.',
      ended: 'This conversation is finished. Thanks.',
      log: 'Conversation'
    },
    es: {
      launcher: 'Hablemos',
      subtitle: 'Normalmente responde en un momento',
      close: 'Cerrar chat',
      placeholder: 'Escribe tu mensaje',
      send: 'Enviar',
      sending: 'Enviando',
      offline: 'No pudimos contactar al asistente.',
      retry: 'Reintentar',
      failed: 'Algo salió mal. Inténtalo más tarde.',
      ended: 'Esta conversación terminó. Gracias.',
      log: 'Conversación'
    }
  };

  var script = document.currentScript;

  if (!script) {
    return;
  }

  var config = {
    endpoint: script.getAttribute('data-endpoint') || '',
    site: script.getAttribute('data-site') || '',
    greeting: script.getAttribute('data-greeting') || '',
    title: script.getAttribute('data-title') || '',
    accent: script.getAttribute('data-accent') || '',
    theme: script.getAttribute('data-theme') || '',
    locale: (script.getAttribute('data-locale') || document.documentElement.lang || 'en')
      .slice(0, 2)
      .toLowerCase()
  };

  if (!config.endpoint || !config.site) {
    // Misconfiguration is a developer problem, not a visitor problem: say so
    // in the console and render nothing.
    console.error('[conserje] data-endpoint and data-site are both required.');
    return;
  }

  var t = COPY[config.locale] || COPY.en;
  var storageKey = 'conserje:' + config.site;

  /** sessionStorage is a convenience, not state we depend on. */
  var store = {
    read: function () {
      try {
        var raw = window.sessionStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    write: function (value) {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(value));
      } catch (e) {
        /* private browsing, blocked storage, quota: all survivable */
      }
    },
    clear: function () {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch (e) {
        /* ignore */
      }
    }
  };

  var saved = store.read() || {};
  var state = {
    session: typeof saved.session === 'string' ? saved.session : null,
    history: Array.isArray(saved.history) ? saved.history : [],
    done: saved.done === true,
    open: false,
    busy: false,
    lastMessage: null
  };

  var host = document.createElement('div');
  host.setAttribute('data-conserje', '');

  if (config.theme) {
    host.setAttribute('data-theme', config.theme);
  }

  var root = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  if (config.accent) {
    host.style.setProperty('--cj-accent', config.accent);
  }

  var launcher = el('button', 'launcher', { type: 'button', 'aria-haspopup': 'dialog' });
  launcher.textContent = t.launcher;

  var panel = el('div', 'panel', {
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': config.title || t.launcher
  });
  panel.hidden = true;

  var header = el('div', 'header');
  var headings = el('div');
  var title = el('h2');
  title.textContent = config.title || t.launcher;
  var subtitle = el('p');
  subtitle.textContent = t.subtitle;
  headings.appendChild(title);
  headings.appendChild(subtitle);

  var closeButton = el('button', 'close', { type: 'button', 'aria-label': t.close });
  closeButton.textContent = '×';

  header.appendChild(headings);
  header.appendChild(closeButton);

  // role=log + aria-live=polite means a screen reader announces each new
  // message without stealing focus from the textarea mid-typing.
  var log = el('div', 'log', {
    role: 'log',
    'aria-live': 'polite',
    'aria-relevant': 'additions',
    'aria-label': t.log
  });

  var composer = el('form', 'composer');
  var input = el('textarea', null, {
    rows: '1',
    placeholder: t.placeholder,
    'aria-label': t.placeholder,
    maxlength: '1200'
  });
  var send = el('button', 'send', { type: 'submit' });
  send.textContent = t.send;

  composer.appendChild(input);
  composer.appendChild(send);

  panel.appendChild(header);
  panel.appendChild(log);
  panel.appendChild(composer);
  root.appendChild(launcher);
  root.appendChild(panel);

  function el(tag, className, attrs) {
    var node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }

    return node;
  }

  /** Always via textContent: nothing the backend returns is ever parsed as HTML. */
  function renderMessage(role, text) {
    var node = el('div', 'msg ' + (role === 'user' ? 'user' : 'bot'));
    node.textContent = text;
    log.appendChild(node);
    scrollToEnd();
    return node;
  }

  function renderError(message, canRetry) {
    var node = el('div', 'msg error');
    node.textContent = message;

    if (canRetry && state.lastMessage) {
      var button = el('button', 'retry', { type: 'button' });
      button.textContent = t.retry;
      button.addEventListener('click', function () {
        var pending = state.lastMessage;
        node.remove();
        state.lastMessage = null;
        submit(pending);
      });
      node.appendChild(button);
    }

    log.appendChild(node);
    scrollToEnd();
  }

  function showTyping() {
    var node = el('div', 'typing', { 'aria-hidden': 'true' });
    node.appendChild(el('span'));
    node.appendChild(el('span'));
    node.appendChild(el('span'));
    log.appendChild(node);
    scrollToEnd();
    return node;
  }

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight;
  }

  function persist() {
    store.write({ session: state.session, history: state.history, done: state.done });
  }

  function setBusy(busy) {
    state.busy = busy;
    send.disabled = busy || state.done;
    input.disabled = busy || state.done;
    send.textContent = busy ? t.sending : t.send;
  }

  function finish() {
    state.done = true;
    setBusy(false);
    input.placeholder = t.ended;
    persist();
  }

  function restore() {
    log.textContent = '';

    if (state.history.length === 0 && config.greeting) {
      state.history.push({ role: 'bot', text: config.greeting });
    }

    state.history.forEach(function (entry) {
      renderMessage(entry.role, entry.text);
    });

    if (state.done) {
      input.placeholder = t.ended;
      send.disabled = true;
      input.disabled = true;
    }
  }

  function submit(text) {
    state.lastMessage = text;
    state.history.push({ role: 'user', text: text });
    renderMessage('user', text);
    persist();
    setBusy(true);

    var typing = showTyping();
    var body = { message: text };

    if (state.session) {
      body.session = state.session;
    }

    var url = config.endpoint
      + (config.endpoint.indexOf('?') === -1 ? '?' : '&')
      + 'site=' + encodeURIComponent(config.site);

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        typing.remove();
        setBusy(false);

        if (!result.ok) {
          var error = (result.data && result.data.error) || {};
          renderError(error.message || t.failed, error.retryable === true);

          if (error.code === 'session_closed') {
            finish();
          }

          return;
        }

        state.lastMessage = null;

        if (typeof result.data.session === 'string') {
          state.session = result.data.session;
        }

        var reply = typeof result.data.reply === 'string' ? result.data.reply : '';

        if (reply) {
          state.history.push({ role: 'bot', text: reply });
          renderMessage('bot', reply);
        }

        if (result.data.done === true) {
          finish();
        } else {
          persist();
          input.focus();
        }
      })
      .catch(function () {
        typing.remove();
        setBusy(false);
        // Network-level failure: the message never reached the server, so
        // retrying it is always safe.
        renderError(t.offline, true);
      });
  }

  function open() {
    state.open = true;
    panel.hidden = false;
    launcher.hidden = true;

    if (!state.done) {
      input.focus();
    }

    scrollToEnd();
  }

  function close() {
    state.open = false;
    panel.hidden = true;
    launcher.hidden = false;
    launcher.focus();
  }

  launcher.addEventListener('click', open);
  closeButton.addEventListener('click', close);

  composer.addEventListener('submit', function (event) {
    event.preventDefault();

    var text = input.value.trim();

    if (!text || state.busy || state.done) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    submit(text);
  });

  // Enter sends, Shift+Enter breaks the line -- the convention every chat UI
  // has trained people to expect.
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  root.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.open) {
      close();
    }
  });

  restore();
  document.body.appendChild(host);

  // Minimal programmatic surface, so a host page can wire the widget to its
  // own call-to-action buttons.
  window.Conserje = {
    open: open,
    close: close,
    reset: function () {
      store.clear();
      state.session = null;
      state.history = [];
      state.done = false;
      state.lastMessage = null;
      input.disabled = false;
      send.disabled = false;
      input.placeholder = t.placeholder;
      restore();
    }
  };
})();
