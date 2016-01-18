var reconnectNet = require('reconnect-net')
var allContainers = require('docker-allcontainers')

var LOGSTASH_HOST = process.env.LOGSTASH_HOST || 'localhost'
var LOGSTASH_PORT = process.env.LOGSTASH_PORT || 50917
var ENV_WHITELIST = (process.env.ENV_WHITELIST || '')
    .split(',')
    .filter(function(v) { return !!v })

var handlers = {}

var ac = allContainers({
    preheat: true,
    docker: null
})
ac.on('start', onContainerStart)
ac.on('stop', onContainerStop)

function onContainerStart(meta, container) {
    var h = new Handler(container, meta)
    h.onStart()
}

function onContainerStop(meta, container) {
    var h = handlers[container.id]
    if (h) {
        h.onStop()
    }
}

function Handler(container, meta) {
    this.id = container.id
    this.shortId = container.id.substring(0, 12)
    this.container = container
    this.meta = meta

    handlers[this.id] = this
}

Handler.prototype.onStart = function() {
    var self = this
    this.log('Started')
    this.container.inspect(function(err, info) {
        if (err) {
            return handleError(err)
        }
        self.env = parseEnv(info.Config.Env)
        if (self.whitelisted()) {
            self.init()
        } else {
            self.log('Not whitelisted, ignoring')
            self.destroy()
        }
    })
}

Handler.prototype.whitelisted = function() {
    var self = this
    return ENV_WHITELIST.every(function(key) {
        return !!self.env[key]
    })
}

Handler.prototype.init = function() {
    this.initContainerStream()
    this.initLogstash()
}

Handler.prototype.initContainerStream = function() {
    var self = this
    this.getContainerStream(function(err, stream) {
        if (err) {
            //TODO: Should we retry?
            return handleError(err)
        }

        self.containerStream = stream

        stream.on('end', function(e) {
            if (!self.destroyed) {
                self.log('Container stream ended unexpectedly, will try to re-attach')
                self.containerStream = null

                //Try again
                //TODO: Backoff?
                self.initContainerStream()
            }
        })

        self.pipeToLogstash()
    })
}

Handler.prototype.getContainerStream = function(callback) {
    if (this.env.DUKALUK_CONTAINER_PATH) {
        this.getLogPathStream(callback)
    } else {
        this.getAttachStream(callback)
    }
}

Handler.prototype.getLogPathStream = function(callback) {
    var self = this
    var logPath = this.env.DUKALUK_CONTAINER_PATH
    this.container.exec({Cmd: ['tail', '-f', logPath], AttachStdout: true, AttachStderr: true}, function(err, exec) {
        if (err) {
            return callback(err)
        }
        exec.start(function(err, stream) {
            if (err) {
                return callback(err)
            }
            self.log('Tailing ' + logPath)
            callback(null, stream)
        })
    })
}

Handler.prototype.getAttachStream = function(callback) {
    var self = this
    this.container.attach({stream: true, stdout: true, stderr: true}, function(err, stream) {
        if (err) {
            return callback(err)
        }
        self.log('Attached')
        callback(null, stream)
    })
}

Handler.prototype.initLogstash = function(callback) {
    var self = this
    this.logstashReconnect = reconnectNet(function(socket) {
        self.log('Connected to Logstash')
        self.logstashSocket = socket
        self.pipeToLogstash()
    })
    this.logstashReconnect.connect({
        host: LOGSTASH_HOST,
        port: LOGSTASH_PORT
    })
    this.logstashReconnect.on('error', function(e) {
        self.log('Logstash error: ' + e.message)
    })
    this.logstashReconnect.on('disconnect', function() {
        if (!self.destroyed) {
            self.log('Disconnected from Logstash')
        }
        self.logstashSocket = null
    })
    this.logstashReconnect.on('reconnect', function(n) {
        self.log('Reconnecting to Logstash (' + n + ')')
    })
}

Handler.prototype.pipeToLogstash = function() {
    if (!this.containerStream || !this.logstashSocket) {
        return
    }
    this.log('Piping')
    this.container.modem.demuxStream(this.containerStream, this.logstashSocket, this.logstashSocket)
}

Handler.prototype.log = function(message) {
    console.log('[' + new Date().toISOString() + '] id=' + this.shortId + ' image=' + this.meta.image + ': ' + message)
}

Handler.prototype.onStop = function() {
    this.log('Stopped')
    this.destroy()
}

Handler.prototype.destroy = function() {
    this.destroyed = true
    if (this.containerStream) {
        this.containerStream.unpipe()
    }
    if (this.logstashReconnect) {
        this.logstashReconnect.disconnect()
    }
    delete handlers[this.id]
}

function handleError(e) {
    if (!e) {
        return
    }
    console.error('ERROR')
    console.error(e.stack || e.message)
}

function parseEnv(env) {
    var out = {}
    env.forEach(function(v) {
        var s = v.split('=', 2)
        out[s[0]] = s[1]
    })
    return out
}
