var debug = require('debug')('app'),
    redis = require('redis'),
    mongoose = require('mongoose'),
    cluster = require('cluster'),
    fs = require('fs'),
    config,
    _clusterId,
    client;

if (cluster.isMaster) {
    // Create cluster unique identifier
    _clusterId = require('node-uuid').v4();
    debug('Initializing Cluster Master with ID: ' + _clusterId);
    debug('Process id of master thread is: ' + process.pid);
    Initialize(function(){
         // Setup interesting events
    cluster.on('exit', function(worker,code,signal){
        if (signal){
            debug('Worker was killed by explicit signal: ' + signal);
        } else if (code !==0) {
            debug('Worker exited with error code: ' + code);
            console.log(code);
        } else {
            debug('Worker has completed all tasks, and exited');
        }
        debug('worker with process id ' + worker.process.pid + ' just exited');
        spawnWorker();
    });
    process.on('uncaughtException', exitHandler.bind(null,{exit:true}));

    // Perform CI Setup here.
    debug('Completed setup, spawning worker');
    spawnWorker();
    });
}
else if (cluster.isWorker) {
    debug('Worker initializing using clusterId ' + process.env['SKYNET_CLUSTERID']);
    debug('Worker process id is: ' + cluster.worker.process.pid);
};

function spawnWorker() {
    debug('Spawning new worker');
    var worker_env ={};
    worker_env['SKYNET_CLUSTERID'] = _clusterId;
    cluster.fork(worker_env);
};
function Initialize(cb) {
    if (typeof(process.env.NODE_ENV) === 'undefined') {
        debug("You've not assigned a value to NODE_ENV.  Looking for config/default.json");
        fs.access('./config/default.json',fs.F_OK,function(err){
            if (!err) {
                debug('Loading default configuration...');
                config = require('config');
                initialize_step2(function(){
                    cb();
                })
            } else {
              shutdownCluster("Default json doesn't exist, therefore no configuration is availabile to continue - EXITING");
            }
        });
    } else {
        debug('Loading configuration of master using NODE_ENV, which is presently: ' + process.env.NODE_ENV);
        config = require('config');
        initialize_step2(function(){
            cb();
        });
    }

    //client = redis.createClient("redis://redis-18170.c10.us-east-1-2.ec2.cloud.redislabs.com:18170");
    //config = require('config');
};
function initialize_step2(cb) {
    debug('Beginning step 2 of initialization');
    initialize_redis(function(){
        // Initialize mongodb
        initialize_mongo(function(){
            cb();
        });

    });
};
function shutdownCluster(reason){
    debug(reason);
    cluster.disconnect(function(){
        process.exit(-1);
    })
};
function initialize_mongo(cb) {
    debug('Initializing MONGOOSE Client and establishing connection to server');
    if (config.mongo == null) {
        shutdownCluster('Configuration not supplied for mongodb initialization or configuration was not successfully loaded, exiting');
    } else {
        var dbURI = "mongodb://" + config.mongo.user + ":" + config.mongo.password + "@" +config.mongo.host + ":" +config.mongo.port + "/" + config.mongo.db;
        mongoose.connect(dbURI);

        mongoose.connection.on('connected', function(){
            debug('Connection established to Mongodb at: ' + dbURI);
            cb();
        });

        mongoose.connection.on('error', function(){
            debug('Connection error with to MONGODB at: ' + dbURI);
        });

        mongoose.connection.on('disconnected', function(){
            debug('Mongoose connection has been disconnected, shutting down cluster');
            shutdownCluster("Lost connection to Mongodb");
        });


    }
};
function initialize_redis(cb) {
    debug('Initializing REDIS Client and establishing connection to server');
    if (config.redis == ''){
        shutdownCluster('Configuration not supplied for redis initialization or configuration not successfully loaded, exiting');
    } else {
        client = redis.createClient(config.redis);
        client.on('connect', function() {
            debug('Connection established to REDIS at: ' + config.redis);
        });

        client.on('ready', function() {
            debug('REDIS server reporting ready...');
            cb();
        })

        client.on('error', function(){
            debug('Error connecting to REDIS Server at: ' + config.redis + " shutting down cluster.");
            shutdownCluster("Lost connection to Redis");
        });

        client.on('end', function(){
            debug('REDIS has been disconnected, as requested');
        })


    }
};
function exitHandler(options,err) {
    debug('Exit Handler invoked...');
    if (options.cleanup || options.exit || options.cleanup===null) {
        debug("Shutting down connected services, process is terminating");
        debug('Closing Mongodb Connection');
        mongoose.connection.close(function(){
            debug("Mongodb connection closed");
        });
        debug('Flushing REDIS client data to server');
    }

    if (err) {
        debug("Processing error occurred, see Stack trace info below:");
        debug(err.stack);
    }
};