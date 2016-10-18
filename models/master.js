var mongoose = require('mongoose');
var ObjectId = mongoose.Schema.Types.ObjectId;

module.exports = function() {
    var masterSchema = new mongoose.Schema({
        master_id           :    {type: String, index: true},
        hosts: [ObjectId]
    });
    // declare seat covers here too
    var models = {
      Master : mongoose.model('Master', masterSchema),
     //SeatCovers : mongoose.model('SeatCovers', SeatCover)
    };
    return models;
};