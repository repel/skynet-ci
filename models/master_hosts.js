module.exports = function(mongoose) {
    var MasterHost = new Schema({
        master_id           :    {type: Objectid, index: true},
        hosts               : [master_host],
        colors              :    {
            colorName       :    String,
            colorId         :    String,
            surcharge       :    Number
        }
    });
    // declare seat covers here too
    var models = {
      Master : mongoose.model('Masters', Master),
     //SeatCovers : mongoose.model('SeatCovers', SeatCover)
    };
    return models;
}