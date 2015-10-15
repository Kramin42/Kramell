#!/bin/env node

// Author: Cameron Dykstra
// Email: dykstra.cameron@gmail.com

// TODO: make it parse the milestone/log files and make its own announcements, independent of other bots.
// see: https://github.com/neilmoore/sizzell/blob/sizzell/sizzell.pl
// particularly see: parse_milestone_file() and parse_log_file()

var express = require('express');
var fs = require('fs');
var Promise = require('bluebird');
var math = require('mathjs');

var exec = require('child_process').exec;

// IRC bot
var botnick = 'Kramell';
var password;
var chei = 'Cheibriados';
var gretell = 'Gretell';
var sequell = 'Sequell';
var irc = require('irc');
var observe_channel = '##crawl';
//var rawannounce_channel = '##crawl-announcements';
var freenodeBot;
var efnetBot;
var bot;
var freenodeAddress = 'chat.freenode.net';
var efnetAddress = 'irc.choopa.net';

var adminlist = ['Kramin', 'Kramin42'];

fs.readFile(process.env.OPENSHIFT_DATA_DIR + '/password', function(err, data) {
    if (err) throw err;
    password = data;
});

//mongoDB stuff
var ip_addr = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';
var port = process.env.OPENSHIFT_NODEJS_PORT || '8080';
// default to a 'localhost' configuration:
var connection_string = '127.0.0.1:27017/kramell';
// if OPENSHIFT env variables are present, use the available connection info:
if (process.env.OPENSHIFT_MONGODB_DB_PASSWORD) {
    connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ':' +
        process.env.OPENSHIFT_MONGODB_DB_PASSWORD + '@' +
        process.env.OPENSHIFT_MONGODB_DB_HOST + ':' +
        process.env.OPENSHIFT_MONGODB_DB_PORT + '/' +
        process.env.OPENSHIFT_APP_NAME;
}
console.log('connection_string: ' + connection_string);
//var mongojs = require('mongojs');
// var db = mongojs(connection_string, ['announcers','channels','csdc','nick_aliases','dieselrobin']);
// var announcers = db.collection('announcers');
// var channels = db.collection('channels');
// var csdc = db.collection('csdc');
// var nick_aliases = db.collection('nick_aliases');
// var dieselrobin = db.collection('dieselrobin');
var pmongo = require('promised-mongo');
var db = pmongo(connection_string, ['announcers', 'channels', 'csdc', 'nick_aliases', 'dieselrobin']);
var announcers = db.collection('announcers');
var channels = db.collection('channels');
var csdc = db.collection('csdc');
var nick_aliases = db.collection('nick_aliases');
var dieselrobin = db.collection('dieselrobin');

var control_channel = '##kramell';
var forbidden = ['##crawl', '##crawl-dev', '##crawl-sequell'];

var csdcrunning = true;
var fetchlimit = 1024 * 100 - 2;

var timers = {};
var NAnick;
var NAaliases;
var cheiquerychan = control_channel;
var gretellquerychan = control_channel;
//var sequellquerychan = control_channel;
var logacc = {};
var fetching = {};

function pad(n) {
    return (n < 10) ? ('0' + n.toString()) : n.toString();
}

function getTimeStamp() {
    now = new Date();
    return parseInt(now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()));
}

function byteCount(s) {
    return encodeURI(s).split(/%..|./).length - 1;
}

/**
 * Function to fix native charCodeAt()
 *
 * Now, we can use fixedCharCodeAt("foo€", 3); for multibyte (non-bmp) chars too.
 *
 * @access public
 * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/String/charCodeAt
 * @note If you hit a non-bmp surrogate, the function will return false
 * @param str String Mixed string to get charcodes
 * @param idx Integer Position of the char to get
 * @return code Integer Result charCodeAt();
 */
function fixedCharCodeAt(str, idx) {
    idx = idx || 0;
    var code = str.charCodeAt(idx);
    var hi, low;
    if (0xD800 <= code && code <= 0xDBFF) { // High surrogate (could change last hex to 0xDB7F to treat high private surrogates as single characters)
        hi = code;
        low = str.charCodeAt(idx + 1);
        if (isNaN(low)) {
            throw 'Kein gültiges Schriftzeichen oder Speicherfehler!';
        }
        return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;
    }
    if (0xDC00 <= code && code <= 0xDFFF) { // Low surrogate
        // We return false to allow loops to skip this iteration since should have already handled high surrogate above in the previous iteration
        return false;
        /*hi = str.charCodeAt(idx-1);
         low = code;
         return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;*/
    }
    return code;
}

/**
 * Gets size of a UTF-8 string in bytes
 *
 * @autor Frank Neff <fneff89@gmail.com>
 * @license GPL v2
 * @access public
 * @param str String Input string to get bytesize
 * @return result String Size of the input string in bytes
 */
function countUtf8(str) {
    var result = 0;
    for (var n = 0; n < str.length; n++) {
        var charCode = fixedCharCodeAt(str, n);
        if (typeof charCode === 'number') {
            if (charCode < 128) {
                result = result + 1;
            } else if (charCode < 2048) {
                result = result + 2;
            } else if (charCode < 65536) {
                result = result + 3;
            } else if (charCode < 2097152) {
                result = result + 4;
            } else if (charCode < 67108864) {
                result = result + 5;
            } else {
                result = result + 6;
            }
        }
    }
    return result;
}

//+ Jonas Raoni Soares Silva
//@ http://jsfromhell.com/array/shuffle [v1.0]
function shuffle(o) { //v1.0
    for (var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
}

Array.prototype.toLowerCase = function() {
    var i = this.length;
    while (--i >= 0) {
        if (typeof this[i] === 'string') {
            this[i] = this[i].toLowerCase();
        }
    }
    return this;
};

function pad2(number) {
    return (number < 10 ? '0' : '') + number;
}

function dictify(milestone) {
    var a = milestone.replace(/::/g, ';;colon;;').replace(/\n/g, '');
    a = a.split(/:/);
    //console.log(JSON.stringify(a));
    a = a.map(function(x) {
        return x.replace(/;;colon;;/g, ':');
    });
    var d = {};
    a.forEach(function(x) {
        x = x.split('=');
        d[x[0]] = x[1];
    });
    return d;
}

function stone_format(stone) {
    return stone['name'] + ' (L' + stone['xl'] + ' ' + stone['char'] + ') ' + stone['milestone'] + ' (' + ((stone['oplace'] && stone['milestone'].search('left') == -1) ? stone['oplace'] : stone['place']) + ')';
}

function log_format(stone) {
    var loc_string = '';
    if (stone['ktyp'] != 'winning' && stone['ktyp'] != 'leaving') {
        if (stone['place'].search(':') > -1) {
            loc_string = ' on ' + stone['place'];
        } else {
            loc_string = ' in ' + stone['place'];
        }
    }

    var dur = parseInt(stone['dur']); //need to format correctly
    var duration = pad2(parseInt(dur / 3600)) + ':' + pad2(parseInt(dur / 60) % 60) + ':' + pad2(dur % 60);

    return stone['name'] + ' the ' + stone['title'] + ' (L' + stone['xl'] + ' ' + stone['char'] + ')' + (stone['god'] ? ' worshipper of ' + stone['god'] : '') + ', ' + (stone['vmsg'] !== undefined ? stone['vmsg'] : stone['tmsg']) + loc_string + ', with ' + stone['sc'] + ' points after ' + stone['turn'] + ' turns and ' + duration + '.';
}

function get_logfile_offset(announcer, url) {
    //curl -sI http://crawl.akrasiac.org/milestones-git | grep Content-Length  | awk '{print $2}'
    var child = exec('curl -sI ' + url + ' | grep Content-Length  | awk \'{print $2}\'');
    child.stdout.on('data', function(data) {
        console.log('setting offset for ' + url + ' to ' + data);
        db.announcers.update({
            name: announcer,
            'files.url': url
        }, {
            $set: {
                'files.$.offset': parseInt(data)
            }
        });
    });

    child.stderr.on('data', function(data) {
        console.log('stderr: ' + data);
    });

    child.on('close', function(code) {
        if (code > 0) {
            console.log('offset fetch for ' + url + ' exited with code ' + code);
        }
    });
}

function get_server_logs(announcer) {
    var delay = 30;
    //  if (fetching[announcer]) {//don't want simultaneous fetches breaking things
    //      console.log("preventing simultaneous fetch for "+announcer);
    //      if (timers[announcer]) {
    //          clearTimeout(timers[announcer]);
    //      }
    //      timers[announcer] = setTimeout(
    //          function() {
    //              console.log("checking "+announcer+" logs on timer");
    //              get_server_logs(announcer);
    //          },
    //          delay*1000
    //      );
    //      return;
    //     }
    //  fetching[announcer] = true;
    //console.log('fetching from '+announcer+': '+fetching[announcer]);
    if (!logacc[announcer]) {
        logacc[announcer] = {};
    }
    //get the array of files and iterate through
    db.announcers.findOne({
        'name': announcer
    }).then(function(server) {
        if (!server || !server['files']) {
            console.log(announcer + ' not found');
        }
        server['files'].forEach(function(file) {
            if (!fetching[file['url']] && file['offset']) {
                fetching[file['url']] = true;
                //console.log("checking "+announcer+" logs");
                if (logacc[announcer][file['url']] === undefined) {
                    logacc[announcer][file['url']] = '';
                }
                // var child = exec('curl -sr '+file["offset"]+'- '+file["url"]);

                //child.stdout.on('data', function (data) {
                var upperlimit = file['offset'] + fetchlimit;
                exec('curl -sr ' + file['offset'] + '-' + upperlimit + ' ' + file['url'], function(error, data, stderr) {
                    if (error) {
                        console.log('Error: ' + error);
                    }
                    if (stderr) {
                        console.log('STDERR: ' + error);
                    }
                    //if (announcer=='Prequell') {console.log('Prequell data: '+data);}
                    if (data.search('416 Requested Range Not Satisfiable') == -1) {
                        var datalength = byteCount(data);
                        var data = logacc[announcer][file['url']] + data;
                        logacc[announcer][file['url']] = '';
                        console.log(announcer + ' data size: ' + datalength + ' bytes');
                        //console.log(data);
                        if (datalength >= fetchlimit - 1) {
                            delay = 10;
                        }

                        //data = data.replace(/\n\n/g,"\n");
                        var datasplit = data.split(/\n/);
                        for (i = 0; i < datasplit.length - 1; i++) {
                            datasplit[i] += '\n';
                        }

                        //datasplit.forEach(function(text) {process_milestone(text,announcer,file["url"])});
                        //console.log("data: "+data);
                        var milestones = datasplit;
                        var process = function() {
                            process_milestone(milestones.shift(), announcer, file['url']).then(function() {
                                if (milestones.length > 0) {
                                    //                                  console.log('iterating to milestone '+milestones.length);
                                    return process();
                                } else {
                                    if (logacc[announcer][file['url']] != '') {
                                        console.log('leftovers in logacc[' + announcer + '][' + file['url'] + ']: ' + logacc[announcer][file['url']]);
                                    }
                                    db.announcers.update({
                                        name: announcer,
                                        'files.url': file['url']
                                    }, {
                                        $set: {
                                            'files.$.offset': file['offset'] + datalength
                                        }
                                    }, function() {
                                        //fetching[announcer] = false;
                                        fetching[file['url']] = false;
                                        //console.log("finished fetch from "+file['url']);
                                    });
                                }
                            });
                        };
                        process();
                    } else {
                        //console.log("no new content");
                        //console.log("no new milestones for "+announcer);
                        //                     fetching[announcer] = false;
                        //if (announcer=='Prequell') {console.log('Prequell fetch finished (nothing found)');}
                        fetching[file['url']] = false;
                    }
                });
            } else {
                console.log(announcer + ' log not found ' + JSON.stringify(file));
            }
        });
    });
    if (timers[announcer]) {
        clearTimeout(timers[announcer]);
    }
    timers[announcer] = setTimeout(
        function() {
            console.log('checking ' + announcer + ' logs on timer');
            get_server_logs(announcer);
        },
        delay * 1000
    );
}

function process_milestone(milestone, announcer, url) {
    var promises = [];
    //milestone = milestone.replace(/\n/g,"");
    //console.log("milestone: "+milestone);
    // make sure it's a complete milestone
    if (!milestone.match(/^v=.*:vlong=.*(time=\d+S:type=.*:milestone=.*|tmsg=.*)\n$/)) {
        //milestone = milestone.replace(/<<<:/g,"").replace(/:>>>/g,"");
        if (milestone.match(/\n/)) {
            console.log('broken milestone: ' + milestone);
            bot.say(control_channel, 'Kramin: broken milestone: ' + milestone);
        } else {
            //console.log("appending to logacc["+announcer+"]["+url+"]: "+milestone);
            logacc[announcer][url] += milestone;
        }
        return Promise.resolve(1);
    }

    try {
        var name = milestone.match(/name=(\w*):/)[1];
        var version = milestone.match(/v=(.*):vlong/)[1];
        var stone = dictify(milestone);
    } catch (error) {
        console.log(error);
        console.log('in milestone: ' + milestone);
        return Promise.resolve(1);
    }

    try {
        //make all announcements to ##crawl-announcements
        //console.log(JSON.stringify(stone));
        var announcement = '';
        if (stone['type']) { //milestone
            announcement = stone_format(stone);
        } else { // death/win
            announcement = log_format(stone);
        }
        //bot.say(rawannounce_channel, announcement);
        db.channels.distinct('names', function(err, names) {
            names.forEach(function(name) {
                //get aliases
                db.nick_aliases.distinct('aliases', {
                    'name': name.toLowerCase()
                }, function(err, alias) {
                    alias = alias[0] ? alias[0] : name;
                    //get the actual alias in use and announce
                    if (stone['name'].search(new RegExp('^(' + alias + ')$', 'i')) > -1) {
                        alias = stone['name'].match(new RegExp('^(' + alias + ')$', 'i'))[1];
                        //console.log("announcement for "+alias);
                        route_announcement(name, alias, stone, announcement);
                    }
                });
            });
        });
    } catch (error) {
        console.log(error);
        console.log('in milestone: ' + milestone);
    }

    //CSDC
    //console.log("milestone for "+name+" ("+version+")");
    //console.log(message);
    if (milestone.match(/v=0.17-a/)) { //trunk only for csdc
        db.nick_aliases.distinct('aliases', {
            'name': 'csdc'
        }, function(err, aliases) {
            if (milestone.search(new RegExp('name=(' + aliases[0] + '):', 'i')) > -1) {
                //console.log("csdc player confirmed, "+name);
                //go through active weeks with the name and return only data for that player (+general data)
                db.csdc.find({
                    'active': true
                }, {
                    'players': {
                        $elemMatch: {
                            'name': name.toLowerCase()
                        }
                    },
                    'char': 1,
                    gods: 1,
                    bonusqual: 1,
                    bonusdisqual: 1,
                    bonusworth: 1,
                    bonusdisqualresetqual: 1,
                    week: 1,
                    start: 1,
                    end: 1
                }).toArray().then(function(weeks) {
                    weeks.forEach(function(week) {
                        //console.log("got week and player data for "+name+": "+JSON.stringify(week));
                        //console.log(JSON.stringify(week));
                        timeStamp = getTimeStamp();
                        //console.log(timeStamp);
                        if (week && timeStamp >= week['start'] && timeStamp < week['end']) {
                            //console.log("data valid and within dates for "+name);
                            if (week['players'] && week['players'][0]) {
                                if (week['players'][0]['alive'] && milestone.search(new RegExp('char=' + week['char'], 'i')) > -1) {
                                    //csdc_announce(name, milestone, week);
                                    //console.log("name: "+alias+", message: "+message+", weekdata: "+JSON.stringify(week));
                                    console.log('check csdc points for ' + name + ' in ' + week['week']);
                                    //console.log(JSON.stringify(week));
                                    check_csdc_points(name, milestone, week);
                                }
                            } else {
                                csdc_enroll(name, week, function() {
                                    //week["players"] = [{"name": name, "points": [0, 0, 0, 0, 0, 0, 0],"bonusdisqual":[], "runes": 0, "alive": true, "tries": 0}];
                                    //csdc_announce(name, message, week);
                                    console.log('enrolled ' + name + ' into csdc ' + week['week']);
                                });
                            }
                            //console.log(milestone);
                        }
                    });
                });
            }
        });
    }

    //dieselrobin
    //get the associated team and account
    var team = db.dieselrobin.findOne({
        'accounts': name.toUpperCase()
    });
    var account = db.dieselrobin.findOne({
        'account': name.toUpperCase()
    });
    var challenge = db.dieselrobin.findOne({
        'challenge': 'dieselrobin'
    });
    promises.push(Promise.all([challenge, team, account]).then(function(data) {
        if (data[0] && data[1] && data[2] && data[2]['alive']) {
            console.log('found dieselrobin milestone: ' + data[2]['account']);
            return check_dieselrobin_points(data[0], data[1], data[2], milestone);
        }
    }));

    return Promise.all(promises);
}

function check_csdc_points(name, milestone, week) {
    console.log(milestone);
    player = week['players'][0];
    points = player['points'];
    xl = parseInt(milestone.match(/xl=(\d+):/i)[1]);
    ch = milestone.match(/char=(\w\w\w\w):/i)[1];
    if (milestone.match(/god=([^:]+):/i)) {
        god = milestone.match(/god=([^:]+):/i)[1];
    } else {
        god = 'No God';
    }

    //0   Go directly to D:1, do not pass char selection, do not collect points
    if (milestone.search(/ktyp=/i) > -1 && !(milestone.search(/ktyp=winning/i) > -1)) {
        //get the xl
        xl = parseInt(milestone.match(/xl=(\d+):/i)[1]);
        //bot.say('##csdc',name+" died at xl: "+xl);
        //one retry if xl<5
        db.csdc.findOne({
            'week': week['week'],
            'players': {
                $elemMatch: {
                    'name': name.toLowerCase(),
                    'tries': 0
                }
            }
        }, function(err, found) {
            if (found && xl < 5) {
                db.csdc.update({
                    'week': week['week'],
                    'players': {
                        $elemMatch: {
                            'name': name.toLowerCase(),
                            'tries': 0,
                            'alive': true
                        }
                    }
                }, {
                    $set: {
                        'players.$.tries': 1
                    }
                }, function(err, updated) {
                    if (updated['n'] > 0) {
                        bot.say('##csdc', irc.colors.wrap('dark_blue', name + ' has died at XL<5 and is eligible to redo the ' + week['week'] + ' challenge'));
                    }
                });
                //console.log(name+" died at xl<5");
            } else {
                db.csdc.update({
                    'week': week['week'],
                    'players': {
                        $elemMatch: {
                            'name': name.toLowerCase(),
                            'alive': true
                        }
                    }
                }, {
                    $set: {
                        'players.$.alive': false
                    }
                }, function(err, updated) {
                    if (updated['n'] > 0) {
                        bot.say('##csdc', irc.colors.wrap('light_blue', name + '\'s final score for ' + week['week'] + ': ' + points.reduce(function(a, b, i) {
                            return a + b;
                        }, 0)));
                    }
                });
                //console.log(name+" is out");
            }
        });
        if (xl > 4) {
            db.csdc.update({
                'week': week['week'],
                'players': {
                    $elemMatch: {
                        'name': name.toLowerCase(),
                        'alive': true
                    }
                }
            }, {
                $set: {
                    'players.$.alive': false
                }
            }, function(err, updated) {
                if (updated['n'] > 0) {
                    bot.say('##csdc', irc.colors.wrap('light_blue', name + '\'s final score for ' + week['week'] + ': ' + points.reduce(function(a, b, i) {
                        return a + b;
                    }, 0)));
                }
            });
        }
    }

    //1   Kill a unique:
    if (milestone.search(/type=uniq:milestone=killed/i) > -1) {
        if (points[0] == 0) {
            //because they could kill uniques in rapid succession I need to check that they don't have that point in the database
            db.csdc.update({
                'week': week['week'],
                'players': {
                    $elemMatch: {
                        'name': name.toLowerCase(),
                        'points.0': 0
                    }
                }
            }, {
                $set: {
                    'players.$.points.0': 1
                }
            }, function(err, updated) {
                if (updated['n'] > 0) {
                    uniqname = milestone.match(/milestone=killed ([^\.]*)\./)[1];
                    bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') killed ' + uniqname + ' for 1 point!'));
                }
            });
        }
    }

    //2   Enter a multi-level branch of the Dungeon:
    if (milestone.search(/type=br.enter/i) > -1 && !(milestone.search(/br=(icecv|volcano|lab|bailey|sewer|bazaar|ossuary|wizlab|trove|temple)/i) > -1)) {
        if (points[1] == 0) {
            branch = milestone.match(/milestone=entered the ([^\.]*)\./)[1];
            bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') entered the ' + branch + ' for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.1': 1
                }
            });
        }
    }

    //3   Reach the end of any multi-level branch (includes D):
    if (milestone.search(/type=br.end/) > -1) {
        if (points[2] == 0) {
            branch = milestone.match(/milestone=reached level \d+ of the ([^\.]*)\./)[1];
            bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') finished the ' + branch + ' for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.2': 1
                }
            });
        }
    }

    //4   Champion a listed god (from weekly list):
    //console.log(new RegExp("Champion of ("+week["gods"]+")")); // <= correct
    if (milestone.search(/type=god.maxpiety|god=Gozag:.*type=god.worship:/) > -1 && milestone.search(new RegExp('god=(' + week['gods'] + ')', 'i')) > -1) {
        if (points[3] == 0 && !player['godabandon']) {
            bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') championed a weekly god (' + god + ') for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.3': 1
                }
            });
        }
    }
    // if they abandon then they lose the point, ((also it must be their first god to get the point)) - not anymore
    if (milestone.search(/type=god.renounce/) > -1) {
        if (points[3] == 1 && milestone.search(/god=Gozag/) > -1) {
            bot.say('##csdc', irc.colors.wrap('dark_red', name + ' (L' + xl + ' ' + ch + ') abandoned a weekly god (' + god + ') and lost their point for championing'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.3': 0
                }
            });
        }
        db.csdc.update({
            'week': week['week'],
            'players.name': name.toLowerCase()
        }, {
            $set: {
                'players.$.godabandon': true
            }
        });
    }

    //5   Collect a rune:
    //6   Collect 3 or more runes in a game:
    if (milestone.search(/type=rune/) > -1) {
        //db.csdc.update({"players.name":name.toLowerCase()},{$inc: {"players.$.runes":1}});
        if (points[4] == 0) {
            bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') found their first rune for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.4': 1
                }
            });
        }
        //csdcdata[csdcwk]['playerdata'][lowername][4]+=1;
        //have at least 3 runes
        if (milestone.search(/urune=(\d\d|[3456789])/) > -1 && points[5] == 0) {
            bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') found their third rune for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.5': 1
                }
            });
        }
    }

    //7   Win a game
    if (milestone.search(/ktyp=winning/) > -1) {
        if (points[6] == 0) {
            bot.say('##csdc', irc.colors.wrap('light_blue', name + ' (L' + xl + ' ' + ch + ') has won a game for 1 point!'));
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.points.6': 1
                }
            });
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: {
                    'players.$.alive': false
                }
            });
            bot.say('##csdc', irc.colors.wrap('light_blue', name + '\'s final score for ' + week['week'] + ': ' + points.reduce(function(a, b, i) {
                return a + b;
            }, 1) + ' points')); //+1 for the win point
        }
    }

    //8,9,etc tier bonus points
    for (i = 0; i < week['bonusworth'].length; i++) {
        //disqualify (only if not already obtained) or reset qualifiers
        if (!points[i + 7] && milestone.search(week['bonusdisqual'][i]) > -1) {
            if (week['bonusdisqualresetqual'] && week['bonusdisqualresetqual'][i]) { //only reset qualifiers
                player['bonusqual'][i] = [];
                toset = {};
                toset['players.$.bonusqual.' + i] = [];
                toset['players.$.points.' + (i + 7)] = 0;
                db.csdc.update({
                    'week': week['week'],
                    'players.name': name.toLowerCase()
                }, {
                    $set: toset
                });
            } else {
                if (!player['bonusdisqual'][i]) {
                    toset = {};
                    toset['players.$.bonusdisqual.' + i] = true;
                    toset['players.$.points.' + (i + 7)] = 0;
                    db.csdc.update({
                        'week': week['week'],
                        'players.name': name.toLowerCase()
                    }, {
                        $set: toset
                    });
                    bot.say('##csdc', irc.colors.wrap('dark_red', name + ' (L' + xl + ' ' + ch + ') can no longer get the tier ' + (i + 1) + ' bonus for ' + week['week']));
                }
            }
        }
        if (!player['bonusqual']) {
            player['bonusqual'] = [];
        }
        if (!player['bonusqual'][i]) {
            player['bonusqual'][i] = [];
        }
        if (week['bonusqual'][i] instanceof Array && player['bonusqual'][i].length != week['bonusqual'][i].length) {
            player['bonusqual'][i][week['bonusqual'][i].length - 1] = false;
            toset = {};
            toset['players.$.bonusqual.' + i] = player['bonusqual'][i];
            db.csdc.update({
                'week': week['week'],
                'players.name': name.toLowerCase()
            }, {
                $set: toset
            });
        }
        //qualify
        if ((player['bonusdisqual'] == [] || !player['bonusdisqual'][i])) {
            qualify = false;
            // && milestone.search(week["bonusqual"][i])>-1
            if (week['bonusqual'][i] instanceof Array) {
                for (j = 0; j < week['bonusqual'][i].length; j++) {
                    if (!player['bonusqual'][i][j] && milestone.search(week['bonusqual'][i][j]) > -1) {
                        player['bonusqual'][i][j] = true;
                        toset = {};
                        toset['players.$.bonusqual.' + i + '.' + j] = true;
                        db.csdc.update({
                            'week': week['week'],
                            'players.name': name.toLowerCase()
                        }, {
                            $set: toset
                        });
                        break;
                    }
                }
                if (player['bonusqual'][i].every(Boolean)) {
                    qualify = true;
                }
            } else {
                if (milestone.search(week['bonusqual'][i]) > -1) {
                    qualify = true;
                }
            }
            if (qualify) {
                if (!points[i + 7]) {
                    toset = {};
                    toset['players.$.points.' + (i + 7)] = week['bonusworth'][i];
                    db.csdc.update({
                        'week': week['week'],
                        'players.name': name.toLowerCase()
                    }, {
                        $set: toset
                    });
                    bot.say('##csdc', irc.colors.wrap('dark_green', name + ' (L' + xl + ' ' + ch + ') has acquired the tier ' + (i + 1) + ' bonus for ' + week['week'] + ', ' + week['bonusworth'][i] + (week['bonusworth'][i] == 1 ? ' point!' : ' points!')));
                }
            }
        }
    }
}

function get_available_dieselrobin_missions(challenge, account) {
    //console.log('checking available missions');
    var availablemissions = [];
    //get uncompleted, available missions
    for (i = 0; i < challenge['missiontext'].length; i++) {
        //console.log(JSON.stringify(account['missionqual'][i])+' | '+account['missionqual'][i].every(Boolean));
        if ((!account['missionqual'][i] || !account['missionqual'][i].every(Boolean)) && !account['missionover'][i]) { //not completed
            //check prerequisites
            //console.log('found uncompleted mission: '+i);
            var prereq = true;
            for (j = 0; j < challenge['missionprereq'][i].length; j++) {
                if (!account['missionqual'][challenge['missionprereq'][i][j]] || !account['missionqual'][challenge['missionprereq'][i][j]].every(Boolean)) {
                    prereq = false;
                    break;
                }
            }
            if (prereq) {
                availablemissions.push(i);
            }
        }
    }
    return availablemissions;
}

function check_dieselrobin_points(challenge, team, account, milestone) {
    var promises = [];
    console.log(milestone);
    if (!account['missionover']) {
        account['missionover'] = [];
        promises.push(db.dieselrobin.update({
            'account': account['account']
        }, {
            $set: {
                'missionover': []
            }
        }));
    }
    var availablemissions = get_available_dieselrobin_missions(challenge, account);
    console.log('available missions: ' + availablemissions);
    var gameover = false;
    if (milestone.search(/ktyp=/i) > -1 && !(milestone.search(/ktyp=winning/i) > -1)) { //YASD
        if (availablemissions[0] == 0) { //still on first mission
            if (!account['retries']) {
                account['retries'] = 0;
            }
            account['retries']++;
            if (account['retries'] < 20) {
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: {
                        'retries': account['retries']
                    }
                }));
                bot.say('##dieselrobin', irc.colors.wrap('dark_red', account['account'] + ' (' + team['team'] + ':' + account['playerorder'][0] + ') has died during the first mission ' + account['retries'] + ' time' + (account['retries'] == 1 ? '' : 's') + ' and may retry ' + (20 - account['retries']) + ' more time' + (account['retries'] == 19 ? '' : 's')));
            } else {
                gameover = true;
            }
        } else {
            gameover = true;
        }
    }

    if (milestone.search(/ktyp=winning/i) > -1) { //YAVP
        gameover = true;
        account['missionpoints'][14] = 4;
        promises.push(db.dieselrobin.update({
            'account': account['account']
        }, {
            $set: {
                'missionpoints.14': 4
            }
        }));
        bot.say('##dieselrobin', irc.colors.wrap('dark_green', account['account'] + ' (Team ' + team['team'] + ') has won for 4 points!'));
    }

    if (gameover) {
        add = function(prev, current) {
            return current + prev;
        };
        var score = account['missionpoints'].reduce(add, 0) + account['bonuspoints'].reduce(add, 0);
        bot.say('##dieselrobin', irc.colors.wrap('light_blue', 'Team ' + team['team'] + '\'s final score for ' + account['char'] + ' (on ' + account['account'] + '): ' + score));
        promises.push(db.dieselrobin.update({
            'account': account['account']
        }, {
            $set: {
                'alive': false
            }
        }));
    }

    //go through available missions and check if newly completed
    for (i = 0; i < availablemissions.length; i++) {
        var mission = availablemissions[i];

        //check stuff exists
        if (!account['missionqual'][mission]) {
            account['missionqual'][mission] = [];
        }
        if (account['missionqual'][mission].length != challenge['missionqual'][mission].length) {
            account['missionqual'][mission][challenge['missionqual'][mission].length - 1] = false;
            toset = {};
            toset['missionqual.' + mission] = account['missionqual'][mission];
            promises.push(db.dieselrobin.update({
                'account': account['account']
            }, {
                $set: toset
            }));
        }

        //check if a mission was started:
        if (!account['missionover'][mission] && milestone.search(challenge['missionstart'][mission]) > -1) {
            if (account['currentmission'] == -1 || account['currentmission'] != mission) {
                bot.say('##dieselrobin', irc.colors.wrap('magenta', account['account'] + ' (' + account['playerorder'][0] + ') has started mission ' + (mission + 1)));

                if (account['currentmission'] != -1 && !account['missionover'][account['currentmission']]) {
                    bot.say('##dieselrobin', irc.colors.wrap('dark_red', account['account'] + ' (' + account['playerorder'][0] + ') has forfeited mission ' + (account['currentmission'] + 1)));
                    account['missionover'][account['currentmission']] = true;
                    toset = {};
                    toset['missionover.' + account['currentmission']] = true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: toset
                    }));
                }

                account['currentmission'] = mission;
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: {
                        'currentmission': mission
                    }
                }));
            }
        }

        //check quals
        for (j = 0; j < challenge['missionqual'][mission].length; j++) {
            if (!account['missionqual'][mission][j] && milestone.search(challenge['missionqual'][mission][j]) > -1) {
                console.log('qualified for: ' + mission + ' (' + j + ')');
                account['missionqual'][mission][j] = true;
                toset = {};
                toset['missionqual.' + mission + '.' + j] = true;
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: toset
                }));
                break;
            }
        }
        if (account['missionqual'][mission].every(Boolean)) { //fully qualified
            var points = 1;
            if (mission == 0 && account['retries'] > 0) {
                points = 0;
            }
            account['missionpoints'][mission] = points;
            toset = {};
            toset['missionpoints.' + mission] = points;
            toset['missionover.' + mission] = true;
            promises.push(db.dieselrobin.update({
                'account': account['account']
            }, {
                $set: toset
            }));
            bot.say('##dieselrobin', irc.colors.wrap('dark_green', account['account'] + ' (' + team['team'] + ', ' + account['playerorder'][0] + ') has completed mission ' + (mission + 1) + ': ' + challenge['missiontext'][mission]));

            var newmissions = get_available_dieselrobin_missions(challenge, account);
            console.log('new available missions: ' + newmissions);
            if (newmissions.length > 0) {
                account['playerorder'].push(account['playerorder'].shift()); //rotate
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: {
                        'playerorder': account['playerorder']
                    }
                }));
            }
            if (newmissions.length > 1) {
                for (n = 0; n < newmissions.length; n++) {
                    newmissions[n]++;
                } //count from 1 for display
                bot.say('##dieselrobin', irc.colors.wrap('magenta', 'Possible next missions for ' + account['account'] + ', to be played by ' + account['playerorder'][0] + ': ' + newmissions.join(', ') + ' (use $mission <num> to see them)'));
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: {
                        'currentmission': -1
                    }
                }));
            } else if (newmissions.length == 1) {
                bot.say('##dieselrobin', irc.colors.wrap('magenta', 'Next mission for ' + account['account'] + ', to be played by ' + account['playerorder'][0] + ': ' + challenge['missiontext'][newmissions[0]] + '. New places: ' + challenge['locations'][newmissions[0]]));
                account['currentmission'] = newmissions[0];
                promises.push(db.dieselrobin.update({
                    'account': account['account']
                }, {
                    $set: {
                        'currentmission': newmissions[0]
                    }
                }));
            }
        }
    }

    //check bonus missions, the qualifiers/disquals are hard coded here.
    var announce = false;
    var bonuswon = -1;
    var points = -1;
    for (i = 0; i < 3; i++) {
        if (!account['bonuspoints'][i] && !account['bonusdisqual'][i]) { //check it's not done already or disqualified
            var j = account['bonusmissions'][i];
            if (i == 0 && j == 0) { //T1A
                if (milestone.search('br=Lair.*type=br.enter') > -1) {
                    account['bonusdisqual'][i] = true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusdisqual.0': true
                        }
                    }));
                } else if (milestone.search('br=Elf.*type=br.end') > -1) {
                    //account['bonusqual'][i]=true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.0': true,
                            'bonuspoints.0': 3
                        }
                    }));
                    announce = true;
                    bonuswon = 0;
                    points = 3;
                }
            }
            if (i == 0 && j == 1) { //T1B
                if (milestone.search('xl=(\d|1[012]):.*br=Lair.*type=br.end') > -1) {
                    //account['bonusqual'][i]=true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.0': true,
                            'bonuspoints.0': 3
                        }
                    }));
                    announce = true;
                    bonuswon = 1;
                    points = 3;
                }
            }
            if (i == 0 && j == 2) { //T1C
                if (!account['bonusqual'][i]) {
                    account['bonusqual'][i] = [];
                }
                if (milestone.search('br=(Swamp|Shoals|Spider|Snake|Slime).*type=br.enter') > -1) {
                    account['bonusdisqual'][i] = true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusdisqual.0': true
                        }
                    }));
                } else if (milestone.search('type=god.renounce') > -1) {
                    account['bonusqual'][i] = [milestone.match(/milestone=abandoned (\w*)\./)[1], false];
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.0': account['bonusqual'][i]
                        }
                    }));
                } else if (account['bonusqual'][i][0] && milestone.search('type=god.worship') > -1) {
                    var oldgod = account['bonusqual'][i][0];
                    var newgod = milestone.match(/god=(\w*):/)[1];
                    if (oldgod != newgod && oldgod != 'Ru' && !(oldgod.search('Ely|The Shining One|Zin') > -1 && newgod.search('Ely|The Shining One|Zin') > -1)) {
                        promises.push(db.dieselrobin.update({
                            'account': account['account']
                        }, {
                            $set: {
                                'bonusqual.0': [true, true],
                                'bonuspoints.0': 3
                            }
                        }));
                        announce = true;
                        bonuswon = 2;
                        points = 3;
                    }
                }
            }

            if (i == 1 && j == 0) { //T2A
                if (milestone.search('type=uniq.*shaped Royal Jelly') > -1) {
                    //account['bonusqual'][i]=[true];
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.1': [true],
                            'bonuspoints.1': 4
                        }
                    }));
                    announce = true;
                    bonuswon = 3;
                    points = 4;
                }
            }
            if (i == 1 && j == 1) { //T2B
                if (milestone.search('type=uniq.*(Cerebov|Lom Lobon|Mnoleg|Gloorx vloq)') > -1) {
                    account['bonusdisqual'][i] = true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusdisqual.1': true
                        }
                    }));
                } else if (milestone.search('place=Pan.*type=rune') > -1) {
                    if (account['bonusqual'][i]) {
                        account['bonusqual'][i]++;
                    } else {
                        account['bonusqual'][i] = 1;
                    }
                    if (account['bonusqual'][i] >= 5) {
                        promises.push(db.dieselrobin.update({
                            'account': account['account']
                        }, {
                            $set: {
                                'bonusqual.1': true,
                                'bonuspoints.1': 4
                            }
                        }));
                        announce = true;
                        bonuswon = 4;
                        points = 4;
                    } else {
                        promises.push(db.dieselrobin.update({
                            'account': account['account']
                        }, {
                            $set: {
                                'bonusqual.1': account['bonusqual'][i]
                            }
                        }));
                    }
                }
            }
            if (i == 1 && j == 2) { //T2C
                if (!account['bonusqual'][i]) {
                    account['bonusqual'][i] = [];
                }
                if (milestone.search('br=Vaults.*type=br.enter') > -1) {
                    account['bonusqual'][i] = [milestone.match(/potionsused=(\d*):/)[1], milestone.match(/scrollsused=(\d*):/)[1]];
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.1': account['bonusqual'][i]
                        }
                    }));
                } else if (account['bonusqual'][i][0] && milestone.search('br=Crypt.*type=br.end') > -1) {
                    //account['bonusqual'][i]=[true];
                    if (milestone.match(/potionsused=(\d*):/)[1] == account['bonusqual'][i][0] && milestone.match(/scrollsused=(\d*):/)[1] == account['bonusqual'][i][1]) {
                        promises.push(db.dieselrobin.update({
                            'account': account['account']
                        }, {
                            $set: {
                                'bonusqual.1': true,
                                'bonuspoints.1': 4
                            }
                        }));
                        announce = true;
                        bonuswon = 5;
                        points = 4;
                    }
                }
            }

            if (i == 2 && j == 0) { //T3A
                if (milestone.search('urune=3') > -1) {
                    account['bonusdisqual'][i] = true;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusdisqual.2': true
                        }
                    }));
                } else if (milestone.search('zigscompleted=1:') > -1) {
                    //account['bonusqual'][i]=[true];
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.2': true,
                            'bonuspoints.2': 8
                        }
                    }));
                    announce = true;
                    bonuswon = 6;
                    points = 8;
                }
            }
            if (i == 2 && j == 1) { //T3B orbrun tomb
                if (milestone.search('type=orb:') > -1) { //get orb
                    account['bonusqual'][i] = 1;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.2': account['bonusqual'][i]
                        }
                    }));
                }
                if (account['bonusqual'][i] == 1 && milestone.search('br=Tomb.*type=br.enter:') > -1) { //enter tomb for first time
                    account['bonusqual'][i] = 2;
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.2': account['bonusqual'][i]
                        }
                    }));
                }
                if (account['bonusqual'][i] == 2 && milestone.search('br=Tomb.*type=rune:') > -1) { //get rune
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.2': true,
                            'bonuspoints.2': 8
                        }
                    }));
                    announce = true;
                    bonuswon = 7;
                    points = 8;

                    // account['missionpoints'][9] = 1;
                    //                  toset = {};
                    //                  toset['missionpoints.9'] = 1;
                    //                  toset['missionover.9'] = true;
                    //                  promises.push(db.dieselrobin.update({'account': account['account']},{$set: toset}));
                    //                  bot.say('##dieselrobin', irc.colors.wrap('dark_green', account['account']+' ('+team['team']+', '+account['playerorder'][0]+') has completed mission '+(10)+': '+challenge['missiontext'][9]));
                }
            }
            if (i == 2 && j == 2) { //T3C
                if (milestone.search('br=Zot.*type=br.enter') > -1) {
                    account['bonusqual'][i] = milestone.match(/kills=(\d*):/)[1];
                    promises.push(db.dieselrobin.update({
                        'account': account['account']
                    }, {
                        $set: {
                            'bonusqual.2': account['bonusqual'][i]
                        }
                    }));
                } else if (milestone.search('type=orb') > -1) {
                    //account['bonusqual'][i]=[true];
                    if (milestone.match(/kills=(\d*):/)[1] == account['bonusqual'][i]) {
                        promises.push(db.dieselrobin.update({
                            'account': account['account']
                        }, {
                            $set: {
                                'bonusqual.2': true,
                                'bonuspoints.2': 8
                            }
                        }));
                        announce = true;
                        bonuswon = 8;
                        points = 8;
                    }
                }
            }
        }
    }
    if (announce) {
        var ABC = ['A', 'B', 'C'];
        bot.say('##dieselrobin', irc.colors.wrap('light_green', account['account'] + ' (' + team['team'] + ', ' + account['playerorder'][0] + ') has completed bonus mission T' + (Math.floor(bonuswon / 3) + 1) + ABC[bonuswon % 3] + ': ' + challenge['bonustext'][bonuswon]));
        toset = {};
        toset['bonusdone.' + bonuswon] = true;
        promises.push(db.dieselrobin.update({
            'team': team['team']
        }, {
            $set: toset
        }));
    }


    return Promise.all(promises);
}

function update_aliases(nick) {
    freenodeBot.say(sequell, '.echo nick-alias:' + nick + ':$(join \' NAJNR\' (split \' \' (nick-aliases ' + nick + ')))');
}

function csdc_enroll(name, week, callback) {
    //csdc_checkdeaths(name, week);
    //check if the alias is in the csdc doc for that week and add otherwise
    db.csdc.update({
        'week': week['week'],
        'players': {
            $not: {
                $elemMatch: {
                    'name': name.toLowerCase()
                }
            }
        }
    }, {
        $addToSet: {
            'players': {
                'name': name.toLowerCase(),
                'points': [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                'bonusdisqual': [],
                'godabandon': false,
                'alive': true,
                'tries': 0
            }
        }
    }, {
        multi: true
    }, callback);
}

function csdc_announce(name, stone, message, week) {
    //should only be one player in the week doc
    player = week['players'][0];
    points = player['points'];
    console.log('checking csdc for ' + player['name'] + ' <=> ' + name + ' in ' + week['week']);

    //check that they have the right char and are in the game still for this week
    if (!((player['alive'] || !stone['type']) && message.search(new RegExp('\\(L\\d+ ' + week['char'] + '\\)', 'i')) > -1)) {
        return;
    }

    //announce the message if they are alive and the right char, then check points after
    announce_with_filters(freenodeBot, '##csdc', stone, message /*, function(){check_csdc_points(name, message, week)}*/ );
}

function announce_with_filters(bot, chan, stone, message, callback) {
    //get the regexes that it must match
    db.channels.distinct('filters', {
        channel: chan
    }, function(err, matches) {
        var matched = true;
        matches.forEach(function(match) {
            if (message.search(match) == -1) {
                matched = false;
            }
        });
        if (matched) {
            //there should only be one colourmap per channel, could just use findOne() and colourmap = doc["colourmap"] here
            db.channels.distinct('colourmap', {
                'channel': chan
            }, function(err, colourmaps) {
                var colour = 'gray';
                var colourmap = colourmaps[0];
                for (match in colourmap) {
                    if (message.search(match) > -1) {
                        colour = colourmap[match];
                    }
                }
                //antiping, put a zero width space in the name
                message = [message[0], message.slice(1)].join('\u200B');
                bot.say(chan, irc.colors.wrap(colour, message));
                if (callback) {
                    callback();
                }
            });
        }
    });
}

function route_announcement(name, alias, stone, message) {
    //go through the channels with the name
    db.channels.distinct('channel', {
    	'server': freenodeAddress,
        'names': {
            $in: [name]
        }
    }, function(err, chans) {
        chans.forEach(function(ch) {
            if (ch == '##csdc' && csdcrunning) {
                db.csdc.find({
                    'active': true
                }, {
                    'players': {
                        $elemMatch: {
                            'name': alias.toLowerCase()
                        }
                    },
                    'char': 1,
                    gods: 1,
                    bonusqual: 1,
                    bonusdisqual: 1,
                    bonusworth: 1,
                    week: 1,
                    start: 1,
                    end: 1
                }).toArray().then(function(weeks) {
                    weeks.forEach(function(week) {
                        //console.log(JSON.stringify(week));
                        timeStamp = getTimeStamp();
                        //console.log(timeStamp);
                        if (week && timeStamp >= week['start'] && timeStamp < week['end']) {
                            if (week['players'] && week['players'][0]) {
                                csdc_announce(name, stone, message, week);
                                //console.log("name: "+alias+", message: "+message+", weekdata: "+JSON.stringify(week));
                            } // else {
                            //                         csdc_enroll(name, week, function(){
                            //                             week["players"] = [{"name": name, "points": [0, 0, 0, 0, 0, 0, 0],"bonusdisqual":[], "runes": 0, "alive": true, "tries": 0}];
                            //                             csdc_announce(name, message, week);
                            //                         });
                            //                     }
                        }
                    });
                });
            }

            if (ch != '##csdc') {
                announce_with_filters(freenodeBot, ch, stone, message);
            }
        });
    });
    
    //efnet
    db.channels.distinct('channel', {
    	'server': efnetAddress,
        'names': {
            $in: [name]
        }
    }, function(err, chans) {
        chans.forEach(function(ch) {
            announce_with_filters(efnetBot, ch, stone, message);
        });
    });
}

function do_command(bot, arg, chan, nick, admin) {
    // commands
    if (arg[0] == 'help' || arg[0] == 'commands') {
        if (chan == '##csdc') {

        } else if (chan == '##dieselrobin') {
            bot.say(chan, 'DieselRobin commands: $signup [-rm] <team name> | $teams | $nominate <char> | $nominated | $assign <char> <account name> <bonus choice (e.g. ACB)> | $mission <mission num/code> | $team [team, player, or account name] | $bonus [team, player, or account name] | $remind [player name] | $scores');

        } else {
            bot.say(chan, 'Kramell commands:');
            if (admin) bot.say(chan, '  $announcer [-rm] <announcer name>');
            if (admin) bot.say(chan, '  $channel [-rm] <channel name>');
            bot.say(chan, '  $name [-rm] <user name>');
            bot.say(chan, '  $filter [-rm] <regex filter>');
            bot.say(chan, '  $colour [-rm] [colour (if not -rm)] <regex filter>');
        }
    }

    if (arg[0] == 'slap') {
        if (arg.length == 1) {
            arg[1] = nick;
        }
        bot.action(chan, 'slaps ' + arg.slice(1, arg.length).join(' ') + ' around a bit with a large trout');
    }

    if (arg[0] == 'dance' && chan != '##crawl') {
        bot.say(chan, ':D|-<');
        setTimeout(function() {
            bot.say(chan, ':D\\-<');
        }, 300);
        setTimeout(function() {
            bot.say(chan, ':D/-<');
        }, 500);
        setTimeout(function() {
            bot.say(chan, ':D\\-<');
        }, 700);
    }

    if (admin && (arg[0] == 'announcer' || arg[0] == 'announcers')) {
        //get announcers
        db.announcers.distinct('name', function(err, ann) {
            if (arg.length > 2 || (arg.length == 2 && arg[1] != '-rm')) {
                if (arg[1] == '-rm') { // arg[2] is the announcer to remove
                    db.announcers.remove({
                        'name': arg[2]
                    });
                    bot.say(control_channel, 'announcer removed (' + chan + '/' + nick + '): ' + arg[2]);
                } else if (ann.indexOf(arg[1]) == -1) { // arg[1] is the announcer to add
                    db.announcers.insert({
                        'name': arg[1],
                        'files': []
                    });
                    bot.say(control_channel, 'announcer added (' + chan + '/' + nick + '): ' + arg[1]);
                }
            } else if (arg.length == 1) {
                bot.say(chan, 'announcers: ' + ann.join(', '));
            } else {
                bot.say(chan, 'Usage: $announcer [-rm] <announcer name>');
            }
        });
    }

    if (admin && arg[0] == 'logfile') {
        if (arg.length > 3 || (arg.length == 3 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                db.announcers.update({
                    'name': arg[2]
                }, {
                    $pull: {
                        'files': {
                            'url': arg[3]
                        }
                    }
                });
            } else {
                db.announcers.update({
                    'name': arg[1]
                }, {
                    $addToSet: {
                        'files': {
                            'url': arg[2]
                        }
                    }
                });
                get_logfile_offset(arg[1], arg[2]);
            }
        } else {
            bot.say(chan, 'Usage: $logfile [-rm] <announcer name> <url>');
        }
    }

    if (admin && (arg[0] == 'channel' || arg[0] == 'channels')) {
        db.channels.distinct('channel', function(err, chans) {
            if (arg.length > 2 || (arg.length == 2 && arg[1] != '-rm')) {
                if (arg[1] == '-rm') {
                    if (chans.indexOf(arg[2]) > -1) { // remove and part from channel arg[2]
                        bot.part(arg[2], '', null);
                        db.channels.remove({
                            'channel': arg[2]
                        });
                    } else {
                        bot.say(chan, 'No such channel');
                    }
                } else if (forbidden.indexOf(arg[1]) == -1) {
                    if (chans.indexOf(arg[1]) > -1) {} else { // add and join channel arg[1]
                        db.channels.insert({
                            'channel': arg[1],
                            'names': [],
                            'filters': [],
                            'colourmap': {
                                '[\\w]*': 'gray'
                            },
                            'server': freenodeAddress
                        });
                        bot.join(arg[1], null);
                    }
                } else {
                    bot.say(chan, 'Sorry, I don\'t allow that channel');
                }
            } else if (arg.length == 1) {
                bot.say(chan, 'channels: ' + chans.join(', '));
            } else {
                bot.say(chan, 'Usage: $channel [-rm] <channel name>');
            }
        });
    }

    if (arg[0] == 'name' || arg[0] == 'names') {
        //db.channels.find({},{"channel":1,"names":1,_id:0})
        if (chan != control_channel) {
            if (arg[1] == '-rm') {
                arg.splice(2, 0, chan);
            } else {
                arg.splice(1, 0, chan);
            }
        }
        if (arg.length > 3 || (arg.length == 3 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                argchan = arg[2];
                argname = arg[3];
                db.channels.update({
                    'channel': argchan
                }, {
                    $pull: {
                        'names': argname
                    }
                });
                bot.say(control_channel, 'name removed (' + chan + '/' + nick + '): ' + argname + ' from ' + argchan);
            } else {
                argchan = arg[1];
                argname = arg[2];
                db.channels.update({
                    'channel': argchan
                }, {
                    $addToSet: {
                        'names': argname
                    }
                });
                update_aliases(argname);
                bot.say(control_channel, 'name added (' + chan + '/' + nick + '): ' + argname + ' to ' + argchan);
            }
        } else if (arg.length == 2) {
            db.channels.distinct('names', {
                'channel': arg[1]
            }, function(err, names) {
                bot.say(chan, 'Names in ' + arg[1] + ': ' + names.join(', '));
            });
        } else {
            bot.say(chan, 'Usage: $name [-rm] <user name>');
        }
    }

    if (arg[0] == 'filter' || arg[0] == 'filters') {
        if (chan != control_channel) {
            if (arg[1] == '-rm') {
                arg.splice(2, 0, chan);
            } else {
                arg.splice(1, 0, chan);
            }
        }
        if (arg.length > 3 || (arg.length == 3 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                //arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[2];
                argfilter = arg[3];
                db.channels.update({
                    'channel': argchan
                }, {
                    $pull: {
                        'filters': argfilter
                    }
                });
                bot.say(control_channel, 'filter removed (' + chan + '/' + nick + '): ' + argfilter + ' from ' + argchan);
            } else {
                //arg[2] = arg.slice(2, arg.length).join(' ');
                argchan = arg[1];
                argfilter = arg[2];
                db.channels.update({
                    'channel': argchan
                }, {
                    $addToSet: {
                        'filters': argfilter
                    }
                });
                bot.say(control_channel, 'filter added (' + chan + '/' + nick + '): ' + argfilter + ' to ' + argchan);
            }
        } else if (arg.length == 2) {
            db.channels.distinct('filters', {
                'channel': arg[1]
            }, function(err, filters) {
                bot.say(chan, 'Filters for ' + arg[1] + ': ' + filters.join(', '));
            });
        } else {
            bot.say(chan, 'Usage: !filter [-rm] <regex filter>');
        }
    }

    if (arg[0] == 'colour' || arg[0] == 'color' || arg[0] == 'colours' || arg[0] == 'colors') {
        if (chan != control_channel) {
            if (arg[1] == '-rm') {
                arg.splice(2, 0, chan);
            } else {
                arg.splice(1, 0, chan);
            }
        }
        if (arg.length > 4 || (arg.length == 4 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                //arg[4] = arg.slice(4, arg.length).join(' ');
                argchan = arg[2];
                argcolour = arg[3];
                argfilter = arg[4];
                toremove = {};
                toremove['colourmap.' + argfilter] = argcolour;
                //console.log("removing "+toremove);
                db.channels.update({
                    'channel': argchan
                }, {
                    $unset: toremove
                });
            } else {
                //arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[1];
                argcolour = arg[2];
                argfilter = arg[3];
                toinsert = {};
                toinsert['colourmap.' + argfilter] = argcolour;
                //console.log("adding "+toinsert);
                db.channels.update({
                    'channel': argchan
                }, {
                    $set: toinsert
                });
            }
        } else if (arg.length == 2) {
            db.channels.distinct('colourmap', {
                'channel': arg[1]
            }, function(err, colourmap) {
                bot.say(chan, 'Colouring filters for ' + arg[1] + ': ' + JSON.stringify(colourmap));
            });
        } else {
            bot.say(chan, 'Usage: !colour [-rm] <colour> <regex filter>');
        }
    }

    if ((arg[0] == 'colors' || arg[0] == 'colours') && arg.length == 1) {
        bot.say(chan, 'Allowed colours: white, black, dark_blue, dark_green, light_red, dark_red, magenta, orange, yellow, light_green, cyan, light_cyan, light_blue, light_magenta, gray, light_gray');
    }

    //dieselrobin commands
    //$signup [-rm] <team> [name]
    if (arg[0] == 'signup' && (chan == '##dieselrobin' || admin)) {
        argteam = '';
        callback = function() {
            db.dieselrobin.distinct('players', {
                'team': new RegExp('^' + argteam + '$', 'i')
            }).then(function(players) {
                //console.log(JSON.stringify(updated));
                bot.say(chan, 'Players in team ' + argteam + ': ' + players.join(', '));
            });
        };
        if (arg.length > 2 || (arg.length == 2 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                argteam = arg[2];
                argname = nick;
                if (arg.length > 3 && admin) argname = arg[3];
                db.dieselrobin.update({
                    'team': new RegExp('^' + argteam + '$', 'i')
                }, {
                    $pull: {
                        'players': {
                            $regex: '^' + argname + '$',
                            $options: 'i'
                        }
                    }
                }, callback);
                bot.say(control_channel, 'player removed (' + chan + '/' + nick + '): ' + argname + ' from ' + argteam);
                db.dieselrobin.remove({
                    'players': []
                });
            } else {
                argteam = arg[1];
                argname = nick;
                if (arg.length > 2 && admin) argname = arg[2];
                db.dieselrobin.findOne({
                    'team': new RegExp('^' + argteam + '$', 'i')
                }, function(err, team) {
                    if (!team || !team['players'] || team['players'].length < 3) {
                        db.dieselrobin.update({
                            'team': new RegExp('^' + argteam + '$', 'i')
                        }, {
                            $addToSet: {
                                'players': argname
                            }
                        }, function(err, updated) {
                            if (updated['n'] == 0) {
                                db.dieselrobin.insert({
                                    'team': argteam,
                                    'players': [argname],
                                    'accounts': [],
                                    'assigned': [],
                                    'nominated': [],
                                    'unassignedbonus': [
                                        [0, 1, 2],
                                        [0, 1, 2],
                                        [0, 1, 2]
                                    ],
                                    'bonusdone': []
                                }, callback);
                            } else {
                                callback();
                            }
                        });
                        bot.say(control_channel, 'player added (' + chan + '/' + nick + '): ' + argname + ' to ' + argteam);
                    } else {
                        bot.say(chan, 'team ' + argteam + ' is already full');
                    }
                });
            }
        } else {
            bot.say(chan, 'Usage: $signup [-rm] <team name> [player nick]');
        }
    }

    //$mission <num|"list">
    if (arg[0] == 'mission' && (chan == '##dieselrobin' || admin)) {
        if (arg.length > 1) {
            if (arg[1] == 'list') {
                //db.dieselrobin.findOne({"challenge": "dieselrobin"}, function(err, challenge) {
                //  for (i=1; i<=challenge["missiontext"].length; i++) {
                //      bot.say(chan, "Mission "+i+": "+challenge["missiontext"][i-1]+". New places: "+challenge["locations"][i-1]);
                //  }
                //});
            } else if (arg[1][0] == 'T' || arg[1][0] == 't') {
                var i = parseInt(arg[1][1]);
                var ABC = ['A', 'B', 'C'];
                var j = ABC.indexOf(arg[1][2]);
                if (j == -1) j = ['a', 'b', 'c'].indexOf(arg[1][2]);
                if (j == -1) j = parseInt(arg[1][2]);
                db.dieselrobin.findOne({
                    'challenge': 'dieselrobin'
                }, function(err, challenge) {
                    bot.say(chan, 'Tier ' + i + ' bonus ' + ABC[j] + ': ' + challenge['bonustext'][(i - 1) * 3 + j]);
                });
            } else {
                var i = parseInt(arg[1]);
                db.dieselrobin.findOne({
                    'challenge': 'dieselrobin'
                }, function(err, challenge) {
                    bot.say(chan, 'Mission ' + i + ': ' + challenge['missiontext'][i - 1] + '. New places: ' + challenge['locations'][i - 1]);
                });
            }
        }
    }

    //$nominate <combo> [player]
    if ((arg[0] == 'nominate') && (chan == '##dieselrobin' || admin)) {
        if (arg.length == 1) {
            arg[1] = nick;
        }
        if (arg.length > 1) {
            if (!admin) {
                arg[3] = nick;
            }
            db.dieselrobin.findOne({
                $or: [{
                    'team': new RegExp('^' + arg[1] + '$', 'i')
                }, {
                    'players': new RegExp('^' + arg[1] + '$', 'i')
                }]
            }).then(function(team) {
                //console.log(JSON.stringify(team));
                if (team) {
                    nom = '';
                    for (i = 0; i < team['nominated'].length; i++) {
                        if (team['nominated'][i]) {
                            newbit = team['nominated'][i] + ' (' + team['players'][i] + ')';
                            if (nom != '') {
                                nom = [nom, newbit].join(', ');
                            } else {
                                nom = newbit;
                            }
                        }
                    }
                    if (nom != '') {
                        bot.say(chan, 'Chars nominated by team ' + team['team'] + ': ' + nom);
                    } else {
                        bot.say(chan, 'No chars nominated by team ' + team['team']);
                    }
                } else {
                    db.dieselrobin.findOne({
                        'nominated': new RegExp(arg[1], 'i')
                    }).then(function(found) {
                        //console.log(JSON.stringify(found));
                        if (found) {
                            bot.say(chan, arg[1] + ' has already been nominated');
                        } else {
                            if (arg.length > 2 && admin) name = arg[2];
                            else name = nick;
                            //console.log('adding combo');
                            db.dieselrobin.findOne({
                                'players': new RegExp('^' + name + '$', 'i')
                            }).then(function(team) {
                                toset = {};
                                toset['nominated.' + team['players'].toLowerCase().indexOf(name.toLowerCase())] = arg[1];
                                db.dieselrobin.update({
                                    'team': team['team']
                                }, {
                                    $set: toset
                                }).then(function(updated) {
                                    //console.log(JSON.stringify(updated));
                                    if (updated) {
                                        bot.say(chan, name + ' (team ' + team['team'] + ') has nominated ' + arg[1]);
                                    } else {
                                        bot.say(chan, 'Join a team first');
                                    }
                                });
                            });
                        }
                    });
                }
            });
        }
    }

    //$nominate <combo> [player]
    if ((arg[0] == 'nominated') && (chan == '##dieselrobin' || admin)) {
        db.dieselrobin.find({
            'team': {
                $exists: true
            }
        }).toArray().then(function(teams) {
            //console.log(JSON.stringify(team));
            var nom = '';
            teams.forEach(function(team) {
                for (i = 0; i < team['nominated'].length; i++) {
                    if (team['nominated'][i]) {
                        newbit = team['nominated'][i];
                        if (nom != '') {
                            nom = [nom, newbit].join(', ');
                        } else {
                            nom = newbit;
                        }
                    }
                }
            });
            if (nom != '') {
                bot.say(chan, 'Chars nominated: ' + nom);
            } else {
                bot.say(chan, 'No chars nominated');
            }
        });
    }

    //$teams
    if (arg[0] == 'teams' && (chan == '##dieselrobin' || chan == '##crawl' || admin)) {
        db.dieselrobin.find({
            'team': {
                $exists: true
            }
        }).toArray().then(function(teams) {
            teamlist = '';
            teams.forEach(function(team) {
                if (teamlist != '') {
                    teamlist = [teamlist, team['team']].join(', ');
                } else {
                    teamlist = team['team'];
                }
            });
            bot.say(chan, 'Teams: ' + teamlist);
        });
    }

    //$team [team name|player name]
    if (arg[0] == 'team' && (chan == '##dieselrobin' || chan == '##crawl' || admin)) {
        if (arg.length == 1) {
            arg[1] = nick;
        }
        if (arg.length == 2) {
            var promises = [];
            db.dieselrobin.findOne({
                $or: [{
                    'team': new RegExp('^' + arg[1] + '$', 'i')
                }, {
                    'players': new RegExp('^' + arg[1] + '$', 'i')
                }, {
                    'accounts': new RegExp('^' + arg[1] + '$', 'i')
                }]
            }).then(function(team) {
                if (team) {
                    //charlist = [];
                    if (team['assigned'].length > 0) {
                        for (i = 0; i < 3; i++) {
                            //charlist+=team['assigned'][i];
                            if (team['accounts'][i]) {
                                promises.push(db.dieselrobin.findOne({
                                    'account': team['accounts'][i]
                                }).then(function(account) {
                                    return (account['alive'] ? account['playerorder'][0] + ' playing ' : 'ANNIHILATED!!! ') + account['char'] + ' on ' + account['account'] + ' (' + account['missionpoints'].reduce(function(a, b, i) {
                                        return a + b;
                                    }, 0) + ' mpts)';
                                }));
                            } else {
                                promises.push(Promise.resolve(team['assigned'][i]));
                            }
                            //if (i<2) {charlist+=', ';}
                        }
                    } else if (team['nominated'].length > 0) {
                        for (i = 0; i < team['nominated'].length; i++) {
                            promises.push(Promise.resolve(team['nominated'][i]));
                            //if (i<team['nominated'].length-1) {charlist+=', ';}
                        }
                    }
                    Promise.all(promises).then(function(charlist) {
                        bot.say(chan, 'Team ' + team['team'] + ': ' + team['players'].join(', ') + ' | ' + charlist.join(', '));
                    });
                } else {
                    bot.say(chan, 'No team or player ' + arg[1] + ' signed up');
                }
            });
        }
    }

    //$assign <combo> <account> <bonusmissions> [player name]
    if (arg[0] == 'assign' && (chan == '##dieselrobin' || admin)) {
        if (arg.length == 4) {
            arg[4] = nick;
        }
        if (arg.length > 4) {
            combo = arg[1];
            account = arg[2].toUpperCase();
            bonusmissions = [-1, -1, -1];
            name = nick;
            if (admin) {
                name = arg[4];
            }
            db.dieselrobin.findOne({
                'players': new RegExp('^' + name + '$', 'i'),
                'assigned': new RegExp(combo, 'i')
            }).then(function(team) {
                if (team) {
                    //see if a previous account was assigned
                    var accountindex = team['assigned'].toLowerCase().indexOf(combo.toLowerCase());
                    var prevaccountname = team['accounts'][accountindex];
                    if (!prevaccountname) prevaccountname = 'nonexistentaccount';
                    db.dieselrobin.findOne({
                        'account': prevaccountname
                    }).then(function(prevaccount) {
                        if (prevaccount) {
                            bonusmissions = prevaccount['bonusmissions'];
                            db.dieselrobin.remove({
                                'account': prevaccount['account']
                            }, true);
                        }
                        playerorder = [];
                        for (i = 0; i < 3; i++) {
                            playerorder[i] = team['players'][(team['players'].toLowerCase().indexOf(name.toLowerCase()) + i) % 3];
                        }

                        for (i = 0; i < 3; i++) {
                            if (bonusmissions[i] > -1) { //readd bonus missions from prev account
                                team['unassignedbonus'][i].push(bonusmissions[i]);
                            }

                            if (arg[3][i] == '0' || arg[3][i] == 'a' || arg[3][i] == 'A') {
                                bonusmissions[i] = 0;
                            } else if (arg[3][i] == '1' || arg[3][i] == 'b' || arg[3][i] == 'B') {
                                bonusmissions[i] = 1;
                            } else if (arg[3][i] == '2' || arg[3][i] == 'c' || arg[3][i] == 'C') {
                                bonusmissions[i] = 2;
                            }
                            if (bonusmissions[i] == -1) {
                                bot.say(chan, 'invalid bonus mission choice');
                                return;
                            }
                            var index = team['unassignedbonus'][i].indexOf(bonusmissions[i]);
                            if (index > -1) {
                                team['unassignedbonus'][i].splice(index, 1);
                            } else {
                                bot.say(chan, 'That Tier ' + (i + 1) + ' bonus mission has already been assigned');
                                return;
                            }
                        }

                        db.dieselrobin.update({
                            'account': account
                        }, {
                            $set: {
                                'char': combo,
                                'playerorder': playerorder,
                                'retries': 0,
                                'alive': true,
                                'comments': [],
                                'newcomments': [],
                                'currentmission': 0,
                                'missionpoints': [],
                                'missionqual': [],
                                'missionover': [],
                                'bonusmissions': bonusmissions,
                                'bonuspoints': [],
                                'bonusqual': [],
                                'bonusdisqual': []
                            }
                        }, {
                            upsert: true
                        });
                        toset = {};
                        toset['bonusmissions.' + accountindex] = bonusmissions;
                        toset['accounts.' + accountindex] = account;
                        toset['unassignedbonus'] = team['unassignedbonus'];
                        db.dieselrobin.update({
                            'team': team['team']
                        }, {
                            $set: toset
                        });
                        bot.say(chan, 'Team ' + team['team'] + ' will play ' + combo + ' on the account ' + account + ', starting with ' + name);
                    });
                } else {
                    bot.say(chan, combo + ' has not been assigned to ' + name + '\'s team');
                }
            });
        }
    }

    //$bonus <player/team name>
    if (arg[0] == 'bonus' && (chan == '##dieselrobin' || admin)) {
        if (arg.length == 1) {
            arg[1] = nick;
        }
        if (arg.length > 1) {
            db.dieselrobin.findOne({
                $or: [{
                    'team': new RegExp('^' + arg[1] + '$', 'i')
                }, {
                    'players': new RegExp('^' + arg[1] + '$', 'i')
                }, {
                    'accounts': new RegExp('^' + arg[1] + '$', 'i')
                }]
            }).then(function(team) {
                if (team) {
                    var s = '';
                    var ABC = ['A', 'B', 'C'];
                    for (i = 0; i < team['accounts'].length; i++) {
                        s += team['accounts'][i] + ' (' + team['assigned'][i] + '): ';
                        for (j = 0; j < 3; j++) {
                            s += 'T' + (j + 1) + ABC[team['bonusmissions'][i][j]];
                            if (team['bonusdone'][j * 3 + team['bonusmissions'][i][j]]) s += ' ✓';
                            if (j < 2) s += ', ';
                        }
                        if (i < team['accounts'].length - 1) s += '; ';
                    }
                    bot.say(chan, 'Team ' + team['team'] + ' bonus assignments: ' + s);
                } else {
                    bot.say(chan, 'No team or player ' + arg[1] + ' signed up');
                }
            });
        }
    }

    if ((arg[0] == 'r' || arg[0] == 'remind') && (chan == '##dieselrobin' || admin)) {
        if (arg.length == 1) {
            arg[1] = nick;
        }
        db.dieselrobin.findOne({
            'challenge': 'dieselrobin'
        }).then(function(challenge) {
            db.dieselrobin.find({
                'playerorder.0': new RegExp('^' + arg[1] + '$', 'i')
            }).toArray().then(function(accounts) {
                var s = [];
                if (accounts[0]) {
                    accounts.forEach(function(account) {
                        if (account['alive']) {
                            var missions = [account['currentmission']];
                            if (missions[0] < 0) {
                                missions = get_available_dieselrobin_missions(challenge, account);
                            }
                            missions = missions.map(function(num) {
                                return num + 1;
                            });
                            missions = missions.join(' or ');
                            s.push('Mission ' + missions + ' on ' + account['account'] + ' (' + account['char'] + ')');
                        }
                    });
                }
                bot.say(chan, arg[1] + ' to do: ' + s.join(', '));
            });
        });
    }

    if (arg[0] == 'scores' && (chan == '##dieselrobin' || chan == '##crawl')) {
        db.dieselrobin.find({
            'team': {
                $exists: true
            }
        }).toArray().then(function(teams) {
            var scores = [];
            //console.log(teams.length);
            teams.forEach(function(team) {
                //console.log('getting points for team '+team['team']);
                //console.log('^'+team['accounts'].join('|')+'$');
                scores.push(db.dieselrobin.find({
                    'account': new RegExp('^(' + team['accounts'].join('|') + ')$', 'i')
                }).toArray().then(function(accounts) {
                    //console.log(JSON.stringify(accounts));
                    if (accounts && accounts[0]) {
                        var missionscores = [];
                        var potmissionscores = [];
                        var score = 1;
                        var potscore = 1; //potential score if they play perfectly from now on
                        accounts.forEach(function(account) {
                            if (account) {
                                console.log(account['account']);
                                //console.log("checking account "+account['account']);
                                score += account['bonuspoints'].reduce(function(a, b, i) {
                                    return a + b;
                                }, 0);
                                missionscores.push(account['missionpoints'].reduce(function(a, b, i) {
                                    return a + b;
                                }, 0));
                                //console.log(score);
                                //console.log(missionscores[missionscores.length - 1]);
                                if (account['alive']) {
                                    potscore += [3, 4, 8].reduce(function(a, b, i) {
                                        return a + (account['bonusdisqual'][i] ? 0 : b);
                                    }, 0);
                                    potmissionscores.push([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4].reduce(function(a, b, i) {
                                        return a + (account['missionover'][i] ? account['missionpoints'][i] : b);
                                    }, 0));
                                } else {
                                    potscore += account['bonuspoints'].reduce(function(a, b, i) {
                                        return a + b;
                                    }, 0);
                                    potmissionscores.push(account['missionpoints'].reduce(function(a, b, i) {
                                        return a + b;
                                    }, 0));
                                }
                                //console.log(potscore);
                                //console.log(potmissionscores[potmissionscores.length - 1]);
                            }
                        });
                        missionscores = missionscores.sort(function(a, b) {
                            return b - a;
                        });
                        potmissionscores = potmissionscores.sort(function(a, b) {
                            return b - a;
                        });
                        score += 2 * missionscores[0] + missionscores[1];
                        potscore += 2 * potmissionscores[0] + potmissionscores[1];
                        //console.log('Points for team '+team['team']+": "+score);
                        return Promise.resolve({
                            'team': team['team'],
                            'score': score,
                            'potscore': potscore
                        });
                    }
                    //console.log('no points for team '+team['team']);
                    return Promise.resolve({
                        'team': team['team'],
                        'score': 0,
                        'potscore': 100
                    });
                }));
            });
            Promise.all(scores).then(function(scorearray) {
                console.log(JSON.stringify(scorearray));
                scorearray = scorearray.sort(function(a, b) {
                    if (a['score'] < b['score']) {
                        return 1;
                    }
                    if (a['score'] > b['score']) {
                        return -1;
                    }
                    return 0;
                });
                var s = [];
                for (i = 0; i < scorearray.length; i++) {

                    s.push(scorearray[i]['team'] + ': ' + scorearray[i]['score'] + (scorearray[i]['score'] == scorearray[i]['potscore'] ? '' : ' (/' + scorearray[i]['potscore'] + ')'));
                }
                bot.say(chan, 'Team scores: ' + s.join(' | '));
            }).done();
        });
    }

    //disabled now
    //if (admin && arg[0]=="shufflechars" && (chan=="##dieselrobin" || admin)) {
    //      db.dieselrobin.distinct('nominated', function(err, chars) {
    //          db.dieselrobin.distinct('team', {$or: [{nominated: {$exists: false}}, {nominated: {$size: 0}}, {nominated: {$size: 1}}, {nominated: {$size: 2}}]}, function(err, unnomteams) {
    //              console.log(JSON.stringify(unnomteams));
    //              if (unnomteams.length>0) {
    //                  bot.say(chan, 'Some teams have not finished nominating: '+unnomteams.join(', '));
    //              } else {
    //                  charcount = chars.length;
    //                  chars = shuffle(chars);
    //                  db.dieselrobin.distinct('team', function(err, teams){
    //                      teams.forEach(function (team) {
    //                          toset = {};
    //                          for (i=0; i<3; i++) {
    //                              toset["assigned."+i] = chars.pop();
    //                          }
    //                          db.dieselrobin.update({'team': team}, {$set: toset});
    //                      });
    //                      bot.say(chan, charcount+" chars assigned to "+teams.length+" teams, randomly");
    //                  });
    //              }
    //          });
    //      });
    //     }

    //CSDC commands
    if (arg[0] == 'csdc') {
        regex = arg.length > 1 ? new RegExp(arg.slice(1, arg.length).join(' '), 'i') : /.*/;
        //console.log(arg.length>1 ? arg.slice(1,arg.length).join(' ') : "default");
        db.csdc.find({
            'week': regex,
            'start': {
                $lte: getTimeStamp()
            },
            'active': true
        }).sort({
            'start': -1
        }).limit(1).toArray().then(function(weeks) {
            week = weeks[0];
            //console.log(week["week"]);
            if (week) {
                scores = [];
                week['players'].forEach(function(player) {
                    //console.log(player["name"]);
                    score = player['points'].reduce(function(a, b, i) {
                        return a + b;
                    }, 0);
                    if (!scores[0]) {
                        scores.push([player['name'], score, player['alive']]);
                        return;
                    }

                    inserted = false;
                    for (i = 0; i < scores.length; i++) {
                        if (score > scores[i][1]) {
                            scores.splice(i, 0, [player['name'], score, player['alive']]);
                            inserted = true;
                            break;
                        }
                    }
                    if (!inserted) {
                        scores.push([player['name'], score, player['alive']]);
                    }
                });
                //console.log(scores);

                pstr = 'Top scores for ' + week['week'] + ': ';
                for (i = 0; i < 10; i++) {
                    if (i != 0) {
                        pstr += ' | ';
                    }
                    pstr += scores[i][0] + ': ' + scores[i][1] + (scores[i][2] ? ' (in prog.)' : '');
                }
                bot.say(chan, pstr);
            }
        });
    }

    if (admin && arg[0] == 'csdcon') {
        if (arg.length > 1) {
            //arg[1] = arg.slice(1, arg.length).join(' ');
            db.csdc.update({
                'week': arg[1]
            }, {
                $set: {
                    'active': true
                }
            }, function(err, updated) {
                //console.log(updated);
                if (updated['n'] > 0) {
                    bot.say(chan, arg[1] + ' on');
                }
            });
        } else {
            csdcrunning = true;
            bot.say(chan, 'csdc on');
        }
    }

    if (admin && arg[0] == 'csdcoff') {
        if (arg.length > 1) {
            //arg[1] = arg.slice(1, arg.length).join(' ');
            db.csdc.update({
                'week': arg[1]
            }, {
                $set: {
                    'active': false
                }
            }, function(err, updated) {
                if (updated['n'] > 0) {
                    bot.say(chan, arg[1] + ' off');
                }
            });
        } else {
            csdcrunning = false;
            bot.say(chan, 'csdc off');
        }
    }

    if (admin && arg[0] == 'csdcweek') {
        if (arg.length > 2 || (arg.length == 2 && arg[1] != '-rm')) {
            if (arg[1] == '-rm') {
                //arg[2] = arg.slice(2, arg.length).join(' ');
                db.csdc.remove({
                    'week': arg[2]
                }, function(err, numberRemoved) {
                    //console.log(numberRemoved);
                    if (numberRemoved['n'] > 0) {
                        bot.say(chan, arg[2] + ' Removed');
                    }
                });
            } else {
                //arg[1] = arg.slice(1, arg.length).join(' ');
                db.csdc.findOne({
                    'week': arg[1]
                }).then(function(week) {
                    if (week) {
                        bot.say(chan, week['week'] + ' active: ' + week['active'] + (week['active'] ? ' (from ' + week['start'] + ' to ' + week['end'] + ')' : ''));
                        bot.say(chan, week['week'] + ' char: ' + week['char']);
                        bot.say(chan, week['week'] + ' gods: ' + week['gods']);
                        //bot.say(chan, "Week "+week["week"] +" t1qual: "+week["t1qual"]);
                        //bot.say(chan, "Week "+week["week"] +" t1disqual: "+week["t1disqual"]);
                        //bot.say(chan, "Week "+week["week"] +" t2qual: "+week["t2qual"]);
                        //bot.say(chan, "Week "+week["week"] +" t2disqual: "+week["t2disqual"]);
                    } else {
                        db.csdc.insert({
                            'week': arg[1],
                            'active': false,
                            'announced': false,
                            'start': 20141002,
                            'end': 20141025,
                            'char': '^$',
                            'gods': '^$',
                            'players': [],
                            'bonusqual': [],
                            'bonusdisqual': [],
                            'bonusworth': [],
                            'bonustext': []
                        }, function(err, inserted) {
                            bot.say(chan, arg[1] + ' Added');
                        });
                    }
                });
            }
        } else {
            bot.say(chan, 'Usage: !csdcweek [-rm] <week name>');
        }
    }

    if (admin && arg[0] == 'csdcset') {
        if (arg.length > 3 && (arg[1] == 'char' || arg[1] == 'gods' || arg[1] == 'start' || arg[1] == 'end')) {
            //arg[3] = arg.slice(3, arg.length).join(' ');
            //arg[2] = arg[2].replace(/_/g,' ');
            if (arg[1] == 'start' || arg[1] == 'end') {
                arg[3] = parseInt(arg[3]);
            }
            toset = {};
            toset[arg[1]] = arg[3];
            db.csdc.update({
                'week': arg[2]
            }, {
                $set: toset
            }, function(err, updated) {
                //console.log(updated);
                if (err) {
                    bot.say(chan, err);
                }
                if (updated['n'] > 0) {
                    bot.say(chan, arg[2] + ' ' + arg[1] + ': ' + arg[3]);
                }
            });
        } else if (arg.length > 4 && arg[1] == 'bonustext') {
            toset = {};
            toset['bonustext.' + arg[3]] = arg[4];
            db.csdc.update({
                'week': arg[2]
            }, {
                $set: toset
            }, function(err, updated) {
                if (err) {
                    bot.say(chan, err);
                }
                if (updated['n'] > 0) {
                    bot.say(chan, arg[2] + ' ' + arg[1] + ' ' + arg[3] + ': ' + arg[4]);
                }
            });
        } else if (arg.length > 6 && arg[1] == 'bonus') {
            toset = {};
            toset['bonusworth.' + arg[3]] = parseInt(arg[4]);
            toset['bonusqual.' + arg[3]] = arg[5];
            toset['bonusdisqual.' + arg[3]] = arg[6];
            db.csdc.update({
                'week': arg[2]
            }, {
                $set: toset
            }, function(err, updated) {
                if (err) {
                    bot.say(chan, err);
                }
                if (updated['n'] > 0) {
                    bot.say(chan, arg[2] + ' ' + arg[1] + ' ' + arg[3] + ' points: ' + arg[4] + ', qual: ' + arg[5] + ', disqual: ' + arg[6]);
                }
            });
        } else {
            bot.say(chan, 'Usage: !csdcset <char|gods|start|end|bonus|bonustext> <week name> <[char]|[god regex]|[start]|[end](YYYYMMDD)|[num] [worth] [qual] [disqual]|[num] [text]>');
        }
    }

    if (admin && arg[0] == 'reconnect') {
        bot.disconnect('reconnecting...', function() {
            connect();
        });
    }
}

function announce_week(bot, week, chan) {
    //console.log(JSON.stringify(week));
    //console.log("announcing "+week["week"]);
    bot.say(chan, irc.colors.wrap('magenta', 'Char: ' + week['char']));
    bot.say(chan, irc.colors.wrap('magenta', 'Gods: ' + week['gods'].replace(/\|/g, ', ')));
    //console.log(week["bonustext"].length+" bonusses: "+JSON.stringify(week["bonustext"]));
    for (i = 0; i < week['bonustext'].length; i++) {
        //console.log("announcing bonus "+i);
        bot.say(chan, irc.colors.wrap('magenta', 'Tier ' + (i + 1) + ' bonus: ' + week['bonustext'][i]));
    }
}

function shield_of_the_gong(bot, chan) {
  message = '';
  if (math.random() > 0.5) {
    message = 'GONNNNG!';
  } else {
    msgs = ['BOUMMMMG!', 'PTOANNNG!', 'PANG!', 'BONNNG!', 'SHROANNG!'];
    message = msgs[math.floor(math.random()*msgs.length)];
  }
  bot.say(chan, message);
}

function handle_message(bot, nick, chan, message) {
    var pm = false;
    if (chan == botnick) {
        chan = nick;
        pm = true;
    }

    if (message.indexOf('Hello ' + botnick) > -1) {
        bot.say(chan, 'Hello!');
    }

    // get announcements
    if (chan == observe_channel || chan == control_channel) { //remove control_channel when all working
        //check if from announcer
        db.announcers.count({
            'name': nick
        }, function(err, count) {
            if (count) {
                //do CSDC weekly combo announcement
                //          db.csdc.findOne({"announced": false, "active": true}, {"week": 1, "start": 1, "char": 1, "gods": 1, "bonustext": 1}).then(function(week) {
                //              //if (week) console.log("checking date for "+week["week"]+", "+getTimeStamp()+">="+week["start"]);
                //              if (week && getTimeStamp() >= week["start"]) {
                //                  db.csdc.update({"week": week["week"]},{$set: {"announced": true}});
                //                  bot.say('##csdc', irc.colors.wrap('magenta', week["week"]+" has begun!"));
                //                  announce_week(week, '##csdc');
                //              }
                //          });

                get_server_logs(nick);

                //console.log("found announcement");
                // go through all names in all channels
                // db.channels.distinct('names',function(err, names) {names.forEach(function(name) {
                //                 //get aliases
                //                 db.nick_aliases.distinct('aliases',{"name":name.toLowerCase()},function(err, alias){
                //                     alias=alias[0] ? alias[0] : name;
                //                     //get the actual alias in use and announce
                //                     if (message.search(new RegExp("^("+alias+") ", "i"))>-1){
                //                         alias = message.match(new RegExp("^("+alias+") ", "i"))[1];
                //                         //console.log("announcement for "+alias);
                //                         route_announcement(name, alias, message);
                //                     }
                //                 });
                //             });});
            }
        });
    }

    // redirect sequell/chei queries
    // if in a post channel
    db.channels.count({
        'channel': chan
    }, function(err, count) {
        if (chan == control_channel || count) {
            if (message[0] == '%') {
                freenodeBot.say(chei, message);
                cheiquerychan = chan;
            }
            if (message[0] == '@') {
                freenodeBot.say(gretell, message);
                gretellquerychan = chan;
            }
            //         if (message.indexOf("!tell")==0 || message.indexOf("!messages")==0) {
            //             bot.say(chan, "Can't use this command in here, sorry");
            //         } else 
            if ('!=&.?^#'.indexOf(message[0]) > -1) {
                freenodeBot.say(sequell, '!RELAY -n 1 -channel ' + (pm ? 'msg' : chan) + ' -nick ' + nick + ' -prefix ' + chan + ':' + ' ' + message);
            }
        }
    });

    // post sequell answers
    if (chan == sequell) {
        msgarray = message.split(':');
        var updateNA = false;
        if (msgarray.length > 2 && msgarray[0] == 'nick-alias') {
            NAnick = msgarray[1];
            NAaliases = msgarray[2].replace(/ NAJNR/g, '|').replace('\r\n', '');
            for (i = 4; i < msgarray.length; i += 2) {
                NAaliases = NAaliases + '|' + msgarray[i].replace(/ NAJNR/g, '|').replace(/NAJNR/g, '').replace('\r\n', '');
            }
            freenodeBot.say(control_channel, 'nick mapping: ' + NAnick + ' => ' + NAaliases);
            updateNA = true;
        } else if (message.search(/^NAJNR/) > -1) {
            for (i = 0; i < msgarray.length; i += 2) {
                NAaliases = NAaliases + '|' + msgarray[i].replace(/ NAJNR/g, '|').replace(/NAJNR/g, '').replace('\r\n', '');
                freenodeBot.say(control_channel, '...|' + msgarray[i].replace(/ NAJNR/g, '|').replace(/NAJNR/g, '').replace('\r\n', ''));
            }
            updateNA = true;
        } else if (msgarray.length > 1) {
            var tempbot;
            db.channels.findOne({'channel': msgarray[0]}).then(function(chandata){
            	console.log(chandata);
                if (chandata['server'] == freenodeAddress) {
                    tempbot = freenodeBot;
                }
                else if (chandata['server'] == efnetAddress) {
                    tempbot = efnetBot;
                }
                
                msgarray[1] = msgarray.slice(1, msgarray.length).join(':');
                if (msgarray[1].slice(0, 4) == '/me ') {
                    tempbot.action(msgarray[0], msgarray[1].slice(4, msgarray[1].length));
                } else {
                    tempbot.say(msgarray[0], msgarray[1].replace('This command cannot be used in PM', 'This Sequell command cannot be used in here'));
                }
            });
        }
        if (updateNA) {
            //add new after clearing
            db.nick_aliases.remove({
                'name': NAnick.toLowerCase()
            }, function(err) {
                db.nick_aliases.insert({
                    'name': NAnick.toLowerCase(),
                    'aliases': NAaliases
                });
            });
        }
    }

    //post chei answers
    if (chan == chei) {
        db.channels.findOne({'channel': cheiquerychan}).then(function(chandata){
            if (chandata['server'] == freenodeAddress) {
                freenodeBot.say(cheiquerychan, message);
            }
            if (chandata['server'] == efnetAddress) {
                efnetBot.say(cheiquerychan, message);
            }
        });
    }

    //post gretell answers
    if (chan == gretell) {
        db.channels.findOne({'channel': gretellquerychan}).then(function(chandata){
            if (chandata['server'] == freenodeAddress) {
                freenodeBot.say(gretellquerychan, message);
            }
            if (chandata['server'] == efnetAddress) {
                efnetBot.say(gretellquerychan, message);
            }
        });
    }

    //Kramell cpo fill in (watch and rc commands)
    //     if (message[0]==='~') {
    //      //remove prefix and add username as first arg if there is none
    //         var arg = message.slice(1, message.length).replace(/ \. /g," "+nick+" ").replace(/ \.$/," "+nick).split(' ');
    //         
    //         if (arg.length==1){
    //             arg[1]=nick;
    //         }
    //         
    //         if (arg[0]=='watch') {
    //          bot.say(chan, "https://crawl.project357.org/watch/"+arg[1]);
    //         }
    //         
    //         if (arg[0]=='rc') {
    //          bot.say(chan, "Not working yet for CPO sorry");
    //         }
    //     }

    //kramell csdc queries (use $)
    if ('$'.indexOf(message[0]) > -1) {
        //remove prefix and add username as first arg if there is none
        var arg = message.trim().slice(1, message.length).replace(/ \. /g, ' ' + nick + ' ').replace(/ \.$/, ' ' + nick).split(' ');

        if (arg[0] == 'help' && (chan == '##csdc' || chan == '##crawl' || chan == control_channel)) {
            bot.say(chan, 'csdc commands: $points <player>, $week <week num>');
        }

        if (arg[0] == 'points') {
            if (arg.length == 1) {
                arg[1] = nick;
            }
            //build pstr backwards
            var pstr = '';
            var s = [];
            var first = true;
            var pname = arg[1];
            db.csdc.find({}, {
                'players': {
                    $elemMatch: {
                        'name': new RegExp(arg[1], 'i')
                    }
                },
                week: 1
            }).toArray().then(function(weeks) {
                weeks.forEach(function(week) {
                    if (week && week['players'] && week['players'][0] && week['week'].match(/(\d+)/)) {
                        s[week['week'].match(/(\d+)/)[1]] = week['week'] + (week['players'][0]['alive'] ? ' (in prog.)' : '') + ': ' + week['players'][0]['points'].reduce(function(a, b, i) {
                            return a + b;
                        }, 0);
                        pname = week['players'][0]['name'];
                    }
                });
                for (i = 0; i < s.length; i++) {
                    if (s[i]) {
                        if (!first) {
                            pstr += ' | ';
                        }
                        pstr += s[i];
                        first = false;
                    }
                }
                pstr = 'Points for ' + pname + ': ' + pstr;
                bot.say(chan, pstr);
            });
        }

        if (arg[0] == 'scoreboard' || arg[0] == 'scorepage' || arg[0] == 'scoresheet') {
            bot.say(chan, 'http://kramell.mooo.com/csdc/scoreboard');
        }

        if (arg[0] == 'info' || arg[0] == 'week') {
            regex = arg.length > 1 ? new RegExp(arg.slice(1, arg.length).join(' '), 'i') : /.*/;
            //console.log(arg.length>1 ? arg.slice(1,arg.length).join(' ') : "default");
            db.csdc.find({
                'week': regex,
                'start': {
                    $lte: getTimeStamp()
                },
                'active': true
            }, {
                'week': 1,
                'start': 1,
                'char': 1,
                'gods': 1,
                'bonustext': 1
            }).sort({
                'start': -1
            }).limit(1).toArray().then(function(weeks) {
                week = weeks[0];
                if (week) {
                    //bot.say(chan, irc.colors.wrap('magenta', "CSDC "+week["week"]);
                    announce_week(bot, week, chan);
                }
            });
        }

        //if (arg[0]=="testpm") {
        //    bot.say(arg[1], arg.slice(2, arg.length));
        //}
    }

    if ('$'.indexOf(message[0]) > -1) {
        //remove prefix and handle " "
        arg = message.slice(1, message.length).trim().split('\"');
        arg = arg.map(function(val, index) {
            return index % 2 == 0 ? val : val.replace(/ /g, 'SPCSPCSPC');
        });
        arg = arg.join('').split(' ');
        arg = arg.map(function(val, index) {
            return val.replace(/SPCSPCSPC/g, ' ');
        });
        //arg = [].concat.apply([], arg);
        console.log(arg);
        admin = (chan == control_channel || adminlist.indexOf(nick) > -1);
        console.log('Admin: ' + admin);
        do_command(bot, arg, chan, nick, admin);
    }

    if(message.search(/\bgong\b/i) > -1 && chan!="##crawl") {
        shield_of_the_gong(bot, chan);
    }

}

function handle_error(error) {
    console.log(error);
}

function handle_quit(nick, reason, channels, message) {
    //console.log("QUIT: "+nick+"; "+reason+"; "+channels+"; "+message);
}

function handle_connect(message) {
    console.log(message);
    console.log('Logging in with nick: ' + botnick + ', pass: ' + password);
    freenodeBot.say('NickServ', 'identify ' + password);
    db.announcers.distinct('name', function(err, announcers) {
        announcers.forEach(function(announcer) {
            timers[announcer] = setTimeout(
                function() {
                    console.log('checking ' + announcer + ' logs (1 min timer)');
                    get_server_logs(announcer);
                },
                60 * 1000
            );
        });
    });
}

function handle_freenode_message(nick, chan, message){
    handle_message(freenodeBot, nick, chan, message);
}

function handle_efnet_message(nick, chan, message){
    handle_message(efnetBot, nick, chan, message);
}

function connect() {
    //connect to IRC
    db.channels.distinct('channel', {'server': freenodeAddress}, function(err, chans) {
        //bot.join(chan,null);
        freenodeBot = new irc.Client(freenodeAddress, botnick, {
            channels: [control_channel, observe_channel].concat(chans),
            port: 8001,
            debug: true,
            autoRejoin: true,
            autoConnect: true,
            //        sasl: true,
            userName: botnick
                //        password: password
        });
        freenodeBot.addListener('message', handle_freenode_message);
        freenodeBot.addListener('error', handle_error);
        freenodeBot.addListener('quit', handle_quit);
        freenodeBot.addListener('registered', handle_connect);
        bot = freenodeBot;
    });
    db.channels.distinct('channel', {'server': efnetAddress}, function(err, chans) {
        //bot.join(chan,null);
        efnetBot = new irc.Client(efnetAddress, botnick, {
            channels: chans,
            port: 6667,
            debug: true,
            autoRejoin: true,
            autoConnect: true,
            //        sasl: true,
            userName: botnick
                //        password: password
        });
        efnetBot.addListener('message', handle_efnet_message);
        efnetBot.addListener('error', handle_error);
        efnetBot.addListener('quit', handle_quit);
        efnetBot.addListener('registered', handle_connect);
    });
}

connect();

//end IRC bot

function nop() {}

//  OpenShift sample Node application

var marked = require('marked');

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === 'undefined') {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_INTERNAL_IP var, using 127.0.0.1');
            self.ipaddress = '127.0.0.1';
        }
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === 'undefined') {
            self.zcache = {
                'index.html': ''
            };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
        //         self.zcache['strapdown.js'] = fs.readFileSync('./strapdown.js');
        self.zcache['dieselrobin/rules.md'] = fs.readFileSync('./dieselrobin/rules.md', 'utf8');
        self.zcache['dieselrobin/missions.md'] = fs.readFileSync('./dieselrobin/missions.md', 'utf8');
        self.zcache['dieselrobin/bonus.md'] = fs.readFileSync('./dieselrobin/bonus.md', 'utf8');
        self.zcache['dieselrobin/workflow.md'] = fs.readFileSync('./dieselrobin/workflow.md', 'utf8');
        self.zcache['strapdown.html'] = fs.readFileSync('./strapdown.html', 'utf8');
        self.zcache['csdc/scoreboardtemplate.htm'] = fs.readFileSync('./csdc/scoreboardtemplate.htm', 'utf8');
        self.zcache['csdc/scoreboard.css'] = fs.readFileSync('./csdc/scoreboard.css', 'utf8');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) {
        return self.zcache[key];
    };

    self.strapdownize = function(markdown) {
        return self.cache_get('strapdown.html').replace('##MARKDOWN##', markdown);
    };

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig) {
        if (typeof sig === 'string') {
            console.log('%s: Received %s - terminating sample app ...',
                Date(Date.now()), sig);
            process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()));
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function() {
        //  Process on exit and signals.
        process.on('exit', function() {
            self.terminator();
        });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() {
                self.terminator(element);
            });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = {};

        // Routes for /health, /asciimo and /
        self.routes['/health'] = function(req, res) {
            res.send('1');
        };

        self.routes['/asciimo'] = function(req, res) {
            var link = 'http://i.imgur.com/kmbjB.png';
            res.send('<html><body><img src=\'' + link + '\'></body></html>');
        };

        self.routes['/'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('index.html'));
        };

        //         self.routes['/strapdown.js'] = function(req, res) {
        //             res.setHeader('Content-Type', 'text/html');
        //             res.send(self.cache_get('strapdown.js') );
        //         };

        self.routes['/dieselrobin/rules'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.strapdownize(self.cache_get('dieselrobin/rules.md')));
        };
        self.routes['/dieselrobin/missions'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.strapdownize(self.cache_get('dieselrobin/missions.md')));
        };
        self.routes['/dieselrobin/bonus'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.strapdownize(self.cache_get('dieselrobin/bonus.md')));
        };
        self.routes['/dieselrobin/workflow'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.strapdownize(self.cache_get('dieselrobin/workflow.md')));
        };

        self.routes['/csdc/scoreboard'] = function(req, res) {
            db.csdc.find().toArray().then(function(weeks) {
                console.log('building scoreboard from ' + weeks.length + ' weeks');
                var tablist = '';
                var tabcontent = '';
                tablist += '<li role="presentation" class="active"><a href="#overall" aria-controls="overall" role="tab" data-toggle="tab">Overall</a></li>';
                var players = {};
                weeklist = [];
                weeks.forEach(function(week) {
                    if (week && week['players'] && week['players'][0] && week['week'].match(/(\d+)/)) {
                        if (weeklist.indexOf(week['week']) == -1) {
                            weeklist.push(week['week']);
                        }
                        week['players'].forEach(function(player) {
                            if (!players[player['name']]) {
                                players[player['name']] = {};
                            }
                            players[player['name']][week['week']] = player['points'];
                        });
                    }
                });

                overalltable = '';
                overalltableheader = '<tr><th>Player</th>';
                weektables = {};
                for (var p in players) {
                    if (players.hasOwnProperty(p)) {
                        //console.log('scanning player ' + p);
                        var totalscore = 0;
                        overalltable += '<tr>' + '<td>' + p + '</td>';
                        weeklist.forEach(function(w) {
                            if (players[p].hasOwnProperty(w)) {
                                if (!weektables[w]) {
                                    weektables[w] = '<tr>  <th>Player</th>    <th>Points</th> <th>uniq</th> <th>br.enter</th> <th>br.end</th> <th>god</th> <th>rune</th> <th>3 runes</th> <th>win</th> <th>T1</th> <th>T2</th></tr>';
                                }
                                s = '';
                                for (var i = 0; i < 9; i++) {
                                    if (!players[p][w][i]) {
                                        players[p][w][i] = 0;
                                    }
                                    s += '<td>' + players[p][w][i] + '</td>';
                                }
                                var pointsum = players[p][w].reduce(function(a, b, i) {
                                    return a + b;
                                }, 0);
                                //console.log(w + ': ' + pointsum);
                                weektables[w] += '<tr>' + '<td>' + p + '</td>' + '<td>' + pointsum + '</td>' + s + '</tr>';
                                overalltable += '<td>' + pointsum + '</td>';
                                totalscore += pointsum;
                            } else {
                                overalltable += '<td>' + 0 + '</td>';
                            }
                        });
                        overalltable += '<td>' + totalscore + '</td>' + '</tr>';
                    }
                }
                for (var week in weektables) {
                    if (weektables.hasOwnProperty(week)) {
                        //console.log(week);
                        tablist += '<li role="presentation"><a href="#' + week.replace(' ', '_') + '" role="tab" data-toggle="tab">' + week + '</a></li>';
                        //console.log(week+", 2");
                        tabcontent += '<div role="tabpanel" class="tab-pane" id="' + week.replace(' ', '_') + '">' + '<table class="table table-hover table-condensed" data-sortable>' + weektables[week] + '</table>' + '</div>';
                        //console.log(week+", 3");
                        overalltableheader += '<th>' + week + '</th>';
                        //console.log(week+", 4");
                    }
                }
                overalltableheader += '<th>Total</th></tr>';
                overalltable = '<table class="table table-hover table-condensed" data-sortable>' + overalltableheader + overalltable + '</table>';
                tabcontent = '<div role="tabpanel" class="tab-pane active" id="overall">' + overalltable + '</div>' + tabcontent;
                //console.log('TABLIST: ' + tablist);
                //console.log('TABCONTENT: ' + tabcontent);
                var result = self.cache_get('csdc/scoreboardtemplate.htm').replace('##TABLIST##', tablist).replace('##TABCONTENT##', tabcontent);
                res.setHeader('Content-Type', 'text/html');
                res.send(result);
            });
        };
        self.routes['/csdc/scoreboard.css'] = function(req, res) {
            res.setHeader('Content-Type', 'text/css');
            res.send(self.cache_get('csdc/scoreboard.css'));
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express.createServer();

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                Date(), self.ipaddress, self.port);
        });
    };

}; /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();
