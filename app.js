var debug = require('debug')('app'),
    redis = require('redis'),
    mongoose = require('mongoose'),
    cluster = require('cluster'),
    path = require('path'),
    fs = require('fs'),
    config,
    _clusterId,
    client,
    lock,
    models = require(path.join(__dirname,'models'))('mongoose'),
    Master = mongoose.model('Master');

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
            redisMasterRegistration(_clusterId,function(){
                debug('Continuing with setup of Master cluster id: ' + _clusterId);
            });

        });

    });
}
function mongodbMasterRegistration(clusterId,cb) {
    Master.create({
        master_id:clusterId
    }, function (err,master) {
        if(err) {
            debug('Unable to register master_id: ' + clusterId + " into Master collection, exiting application.");
            process.exit(-1);
        } else {
            debug('Registered new master_id: ' + clusterId);
            cb(master);
        }
    });
}
function redisMasterRegistration(clusterId, cb) {
    lock = require('redis-lock')(client);
    debug('Aquiring lock on databases for registration of Master...');
    // Two goals on the lock, one create master record in redis.
    // Create record in mongodb for master server id.
    lock('masterLock', function(done){
        debug('Lock aquired, proceeding...creating record in Mongodb');
        mongodbMasterRegistration(clusterId, function(masterItem){
            debug('Registration to Mongodb is completed, establishing subscription to redis');
            client.set(clusterId.toString(),masterItem._id.toString());
            debug('Redis records created, unlocking');
            done(function(){
                debug('Lock released, continuing..pausing for 10 seconds, then removing records simulating a shutdown.');
                setTimeout(function(){
                    shutdownCluster('Test shutdown, should remove records');
                },10000);

            });
        });

    });
}
function shutdownCluster(reason){
    debug(reason);
    debug('Removing Master record from Mongodb Collection');
    Master.find({master_id: _clusterId}).remove(function(results){
        debug('Removed master_id: ' + _clusterId);
    });
    debug('Removing Redis record');
    client.del(_clusterId.toString());
    debug('Redis record removed');
    cluster.disconnect(function(){
        process.exit(-1);
    });
}
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
        });

        client.on('error', function(){
            debug('Error connecting to REDIS Server at: ' + config.redis + " shutting down cluster.");
            shutdownCluster("Lost connection to Redis");
        });

        client.on('end', function(){
            debug('REDIS has been disconnected, as requested');
        });
    }
}
function exitHandler(options,err) {
    debug('Exit Handler invoked...');
    if (options.cleanup || options.exit || options.cleanup===null) {
        debug("Shutting down connected services, process is terminating");
        shutdownCluster('Uncaught exception has occurred, removing records');
        debug('Removing Master record from Mongodb Collection');
        Master.find({master_id: _clusterId}).remove(function(results){
            debug('Removed master_id: ' + _clusterId);
        });
        debug('Removing Redis record');
        client.del(_clusterId.toString());
        debug('Redis record removed');
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