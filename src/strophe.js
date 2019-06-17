define("xabber-strophe", function () {
    return function (xabber) {
        var env = xabber.env,
            Strophe = env.Strophe,
            constants = env.constants;

        Strophe.log = function (log_level, msg) {
            var do_log = (constants.LOG_LEVEL === constants.LOG_LEVEL_DEBUG) ||
                (constants.LOG_LEVEL >= constants.LOG_LEVEL_WARN &&
                    log_level >= Strophe.LogLevel.WARN) ||
                (constants.LOG_LEVEL >= constants.LOG_LEVEL_ERROR &&
                    log_level >= Strophe.LogLevel.ERROR);
            if (do_log) {
                console.info('Strophe log: ');
                console.info(msg);
            }
        };

        var utf16to8 = function (str) {
            var i, c;
            var out = "";
            var len = str.length;
            for (i = 0; i < len; i++) {
                c = str.charCodeAt(i);
                if ((c >= 0x0000) && (c <= 0x007F)) {
                    out += str.charAt(i);
                } else if (c > 0x07FF) {
                    out += String.fromCharCode(0xE0 | ((c >> 12) & 0x0F));
                    out += String.fromCharCode(0x80 | ((c >>  6) & 0x3F));
                    out += String.fromCharCode(0x80 | ((c >>  0) & 0x3F));
                } else {
                    out += String.fromCharCode(0xC0 | ((c >>  6) & 0x1F));
                    out += String.fromCharCode(0x80 | ((c >>  0) & 0x3F));
                }
            }
            return out;
        };

        Strophe.SASLXTOKEN = function() {};
        Strophe.SASLXTOKEN.prototype = new Strophe.SASLMechanism("X-TOKEN", true, 80);

        Strophe.SASLXTOKEN.prototype.test = function (connection) {
            return true;
        };

        Strophe.SASLXTOKEN.prototype.onChallenge = function (connection) {
            var auth_str = String.fromCharCode(0) + connection.authcid +
                String.fromCharCode(0) + connection.pass;
            return utf16to8(auth_str);
        };

        Strophe.ConnectionManager = function (CONNECTION_URL) {
            this.connection = new Strophe.Connection(CONNECTION_URL);
        };

        Strophe.ConnectionManager.prototype = {
            connect: function (auth_type, jid, password, callback) {
                this.connection.mechanisms = {};
                this.auth_type = auth_type || 'password';
                if (this.auth_type === 'password') {
                    this.connection.registerSASLMechanisms([Strophe.SASLAnonymous,
                        Strophe.SASLExternal,
                        Strophe.SASLMD5,
                        Strophe.SASLPlain,
                        Strophe.SASLSHA1]);
                } else if (this.auth_type === 'x-token') {
                    this.connection.registerSASLMechanism(Strophe.SASLXTOKEN);
                } else {
                    this.connection.registerSASLMechanisms([Strophe.SASLXOAuth2]);
                    delete this.connection._sasl_data.server_signature;
                }
                this.connection.connect(jid, password, callback);
            },

            reconnect: function (callback) {
                this.connection.connect(this.connection.jid, this.connection.pass, callback);
            }
        };

        _.extend(Strophe.Connection.prototype, {
            _sasl_auth1_cb: function (elem) {
                this.features = elem;
                var i, child;
                for (i = 0; i < elem.childNodes.length; i++) {
                    child = elem.childNodes[i];
                    if (child.nodeName === 'bind') {
                        this.do_bind = true;
                    }

                    if (child.nodeName === 'session') {
                        this.do_session = true;
                    }

                    if ((child.nodeName === 'x-token') && (child.namespaceURI === Strophe.NS.AUTH_TOKENS)) {
                        this.x_token_auth = true;
                    }

                    if ((child.nodeName === 'synchronization') && (child.namespaceURI === Strophe.NS.SYNCHRONIZATION)) {
                        this.do_synchronization = true;
                    }
                }

                if (!this.do_bind) {
                    this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
                    return false;
                } else {
                    if (this.x_token_auth && (!this.x_token || (parseInt(this.x_token.expire)*1000 < env.moment.now()))) {
                        this.getXToken(function (success) {
                            let token = $(success).find('token').text(),
                                expires_at = $(success).find('expire').text(),
                                token_uid = $(success).find('token-uid').text();
                            this.x_token = {token: token, expire: expires_at, token_uid: token_uid };
                            this.pass = token;
                            this._send_auth_bind();
                        }.bind(this), function () {
                            this._send_auth_bind();
                        }.bind(this));
                    }
                    else {
                        this._send_auth_bind();
                    }
                }
                return false;
            },

            _send_auth_bind() {
                this._addSysHandler(this._sasl_bind_cb.bind(this), null, null,
                    null, "_bind_auth_2");

                var resource = Strophe.getResourceFromJid(this.jid);
                if (resource) {
                    this.send($iq({type: "set", id: "_bind_auth_2"})
                        .c('bind', {xmlns: Strophe.NS.BIND})
                        .c('resource', {}).t(resource).tree());
                } else {
                    this.send($iq({type: "set", id: "_bind_auth_2"})
                        .c('bind', {xmlns: Strophe.NS.BIND})
                        .tree());
                }
            },

            getXToken: function (callback, errback) {
                let uniq_id = uuid(),
                    iq = $iq({
                    type: 'set',
                    to: this.domain,
                    id: uniq_id
                }).c('issue', { xmlns: Strophe.NS.AUTH_TOKENS})
                    .c('client').t(xabber.get('client_name')).up()
                    .c('device').t('PC ' + navigator.platform);

                handler = function (stanza) {
                    var iqtype = stanza.getAttribute('type');
                    if (iqtype == 'result') {
                        if (callback) {
                            callback(stanza);
                        }
                    } else if (iqtype == 'error') {
                        if (errback) {
                            errback(stanza);
                        }
                    } else {
                        throw {
                            name: "StropheError",
                            message: "Got bad IQ type of " + iqtype
                        };
                    }
                };

                this._addSysHandler(handler.bind(this), Strophe.NS.AUTH_TOKENS, 'iq', 'result' , uniq_id);

                this.send(iq.tree());
            }
        });

        Strophe.addNamespace('CARBONS', 'urn:xmpp:carbons:2');
        Strophe.addNamespace('FORWARD', 'urn:xmpp:forward:0');
        Strophe.addNamespace('RECEIPTS', 'urn:xmpp:receipts');
        Strophe.addNamespace('JINGLE_MSG', 'urn:xmpp:jingle-message:0');
        Strophe.addNamespace('JINGLE_RTP', 'urn:xmpp:jingle:apps:rtp:1');
        Strophe.addNamespace('CHATSTATES', 'http://jabber.org/protocol/chatstates');
        Strophe.addNamespace('EXTENDED_CHATSTATES', 'https://xabber.com/protocol/extended-chatstates');
        Strophe.addNamespace('HTTP_AUTH', 'http://jabber.org/protocol/http-auth');
        Strophe.addNamespace('AUTH_TOKENS', 'http://xabber.com/protocol/auth-tokens');
        Strophe.addNamespace('RETRACTIONS', 'http://xabber.com/protocol/retract');
        Strophe.addNamespace('SYNCHRONIZATION', 'http://xabber.com/protocol/synchronization');
        Strophe.addNamespace('DELIVERY', 'http://xabber.com/protocol/delivery');
        Strophe.addNamespace('MAM', 'urn:xmpp:mam:1');
        Strophe.addNamespace('RSM', 'http://jabber.org/protocol/rsm');
        Strophe.addNamespace('XDATA', 'jabber:x:data');
        Strophe.addNamespace('CHAT_MARKERS', 'urn:xmpp:chat-markers:0');
        Strophe.addNamespace('VCARD_UPDATE', 'vcard-temp:x:update');
        Strophe.addNamespace('HTTP_UPLOAD', 'urn:xmpp:http:upload');
        Strophe.addNamespace('BLOCKING', 'urn:xmpp:blocking');
        Strophe.addNamespace('SEARCH', 'jabber:iq:search');
        Strophe.addNamespace('PRIVATE_STORAGE', 'jabber:iq:private');
        Strophe.addNamespace('OOB', 'jabber:x:oob');
        Strophe.addNamespace('MEDIA', 'urn:xmpp:media-element');
        Strophe.addNamespace('LAST', 'jabber:iq:last');
        Strophe.addNamespace('GROUP_CHAT', 'http://xabber.com/protocol/groupchat');
        Strophe.addNamespace('INDEX', 'http://xabber.com/protocol/index');
        Strophe.addNamespace('PUBSUB', 'http://jabber.org/protocol/pubsub');
        Strophe.addNamespace('PUBSUB_AVATAR_DATA', 'urn:xmpp:avatar:data');
        Strophe.addNamespace('PUBSUB_AVATAR_METADATA', 'urn:xmpp:avatar:metadata');
        Strophe.addNamespace('XABBER_REWRITE', 'http://xabber.com/protocol/rewrite');
        Strophe.addNamespace('REFERENCE', 'urn:xmpp:reference:0');

        return xabber;
    };
});
