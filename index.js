var reconnectNet = require('reconnect-net')
var allContainers = require('docker-allcontainers')

var LOGSTASH_HOST = process.env.LOGSTASH_HOST || 'localhost'
var LOGSTASH_PORT = process.env.LOGSTASH_PORT || 50917

containers = {}

var ac = allContainers({
    preheat: true,
    docker: null
})
ac.on('start', onContainerStart)
ac.on('stop', onContainerStop)

function onContainerStart(meta, container) {
    var c = new Container(container, meta)
    c.onStart()
}

function onContainerStop(meta, container) {
    var c = containers[container.id]
    c.onStop()
}

function Container(container, meta) {
    this.id = container.id
    this.shortId = container.id.substring(0, 12)
    this.container = container
    this.meta = meta

    containers[this.id] = this
}

Container.prototype.onStart = function() {
    var self = this
    this.log('Started')
    this.container.inspect(function(err, info) {
        if (err) {
            return handleError(err)
        }
        self.env = parseEnv(info.Config.Env)
        if (self.env.MARATHON_APP_ID) {
            self.init()
        } else {
            self.log('Not a Marathon app')
            self.destroy()
        }
    })
}

Container.prototype.init = function() {
    this.initContainerStream()
    this.initLogstash()
}

Container.prototype.initContainerStream = function() {
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
                self.initLogStream()
            }
        })

        self.pipeFun()
    })
}

Container.prototype.getContainerStream = function(callback) {
    if (this.env.MARATHON_DOCKER_LOGS_PATH) {
        this.getLogPathStream(callback)
    } else {
        this.getAttachStream(callback)
    }
}

Container.prototype.getLogPathStream = function(callback) {
    var self = this
    var logPath = this.env.MARATHON_DOCKER_LOGS_PATH
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

Container.prototype.getAttachStream = function(callback) {
    var self = this
    this.container.attach({stream: true, stdout: true, stderr: true}, function(err, stream) {
        if (err) {
            return callback(err)
        }
        self.log('Attached')
        callback(null, stream)
    })
}

Container.prototype.initLogstash = function(callback) {
    var self = this
    this.logstashReconnect = reconnectNet(function(socket) {
        self.log('Connected to Logstash')
        self.logstashSocket = socket
        self.pipeFun()
    })
    reconnect.connect({
        host: LOGSTASH_HOST,
        port: LOGSTASH_PORT
    })
    reconnect.on('disconnect', function() {
        self.log('Disconnected from Logstash')
        self.logstashSocket = null
    })
    reconnect.on('reconnect', function(n) {
        self.log('Reconnecting to Logstash (' + n + ')')
    })
}

Container.prototype.pipeFun = function() {
    if (!this.containerStream || !this.logstashSocket) {
        return
    }
    this.log('Piping')
    this.container.modem.demuxStream(this.containerStream, this.logstashSocket, this.logstashSocket)
}

Container.prototype.log = function(message) {
    var appId = this.env.MARATHON_APP_ID
    console.log('[' + new Date().toISOString() + '] id=' + this.shortId + ' image=' + this.meta.image + (appId ? ' marathon=' + appId : '') + ': ' + message)
}

Container.prototype.onStop = function() {
    this.log('Stopped')
    this.destroy()
}

Container.prototype.destroy = function() {
    this.destroyed = true
    if (this.containerStream) {
        this.containerStream.unpipe()
    }
    if (this.logstashReconnect) {
        this.logstashReconnect.disconnect()
    }
    delete containers[this.id]
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
