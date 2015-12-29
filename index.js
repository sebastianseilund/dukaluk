//TODO: Try without async
var async = require('async')
var fs = require('fs')
var allContainers = require('docker-allcontainers')

containers = {}

var ac = allContainers({
    preheat: true,
    docker: null
})
.on('start', onContainerStart)
.on('stop', onContainerStop)

function onContainerStart(meta, container) {
    containers[container.id] = {
        image: meta.image
    }
    log(container, 'Started')
    async.waterfall([
        container.inspect.bind(container),
        function(info, callback) {
            var env = parseEnv(info.Config.Env)
            var appId = env.MARATHON_APP_ID
            if (appId) {
                containers[container.id].appId = appId
                streamToFile(container, appId)
            } else {
                log(container, 'Not a Marathon app')
                forget(container)
                callback()
            }
        }
    ], handleError)

}

function parseEnv(env) {
    var out = {}
    env.forEach(function(v) {
        var s = v.split('=', 2)
        out[s[0]] = s[1]
    })
    return out
}

function streamToFile(container, appId, callback) {
    var file = 'logs/' + appId + '-' + shortId(container) + '.log'
    var dest = fs.createWriteStream(file)
    async.waterfall([
        container.attach.bind(container, {stream: true, stdout: true, stderr: true}),
        function(stream, callback) {
            log(container, 'Streaming to ' + file)
            container.modem.demuxStream(stream, dest, dest);
            stream.on('end', callback)
        }
    ], function(e) {
        if (containers[container.id]) {
            log(container, 'Stream ended unexpectedly')
            //TODO: Restart? Example:
            //streamToFile(container, appId, callback)
        }
        handleError(e)
    })
    //Never calls back
}

function onContainerStop(meta, container) {
    log(container, 'Stopped')
    forget(container)
}

function forget(container) {
    var dest = containers[container.id].dest
    if (dest) {
        dest.end()
    }
    //TODO: Should we close the attach stream too just in case?
    delete containers[container.id]
}

function log(container, message) {
    var c = containers[container.id]
    console.log('[' + new Date().toISOString() + '] id=' + shortId(container) + ' image=' + c.image + (c.appId ? ' marathon=' + c.appId : '') + ': ' + message)
}

function shortId(container) {
    return container.id.substring(0, 12)
}

function handleError(e) {
    if (!e) {
        return
    }
    console.error('ERROR')
    console.error(e.stack || e.message)
}
