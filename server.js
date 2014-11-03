#!/bin/env node

// Author: Cameron Dykstra
// Email: dykstra.cameron@gmail.com

var express = require('express');
var fs      = require('fs');

var exec = require('child_process').exec;

// IRC bot
var botnick = 'Kramell';
var password;
var chei = 'Cheibriados';
var sequell = 'Sequell';
var irc = require('irc');
var observe_channel = "##crawl";
var bot;

fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/password', function (err, data) {
    if (err) throw err;
    password = data;
});

//mongoDB stuff
var ip_addr = process.env.OPENSHIFT_NODEJS_IP   || '127.0.0.1';
var port    = process.env.OPENSHIFT_NODEJS_PORT || '8080';
// default to a 'localhost' configuration:
var connection_string = '127.0.0.1:27017/kramell';
// if OPENSHIFT env variables are present, use the available connection info:
if(process.env.OPENSHIFT_MONGODB_DB_PASSWORD){
  connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +
  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" +
  process.env.OPENSHIFT_MONGODB_DB_HOST + ':' +
  process.env.OPENSHIFT_MONGODB_DB_PORT + '/' +
  process.env.OPENSHIFT_APP_NAME;
}
console.log("connection_string: "+connection_string);
var mongojs = require('mongojs');
var db = mongojs(connection_string, ['announcers','channels','csdc','nick_aliases']);
var announcers = db.collection('announcers');
var channels = db.collection('channels');
var csdc = db.collection('csdc');
var nick_aliases = db.collection('nick_aliases');

var control_channel = "##kramell";
var forbidden = ['##crawl','##crawl-dev','##crawl-sequell'];

var csdcrunning = true;

var timers = {};
var NAnick;
var NAaliases;
var cheiquerychan = control_channel;
var sequellquerychan = control_channel;

function pad(n) {
    return (n < 10) ? ("0" + n.toString()) : n.toString();
}

function getTimeStamp() {
    now = new Date();
    return parseInt(now.getUTCFullYear()+pad(now.getUTCMonth()+1)+pad(now.getUTCDate()));
}

function byteCount(s) {
    return encodeURI(s).split(/%..|./).length - 1;
}

function get_logfile_offset(announcer, url) {
    //curl -sI http://crawl.akrasiac.org/milestones-git | grep Content-Length  | awk '{print $2}'
    var child = exec("curl -sI "+url+" | grep Content-Length  | awk '{print $2}'");
    child.stdout.on('data', function (data) {
        console.log("setting offset for "+url+" to "+data);
        db.announcers.update({name: announcer, "files.url": url}, {$set: {"files.$.offset": parseInt(data)}});
    });
    
    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
    });
    
    child.on('close', function (code) {
        if (code>0) {console.log('offset fetch for '+url+' exited with code ' + code);}
    });
}

function get_server_logs(announcer) {
    //get the array of files and iterate through
    db.announcers.findOne({"name": announcer}, function(err, server) {server["files"].forEach(function(file) {
        if (file["offset"]) {
            var child = exec('curl -sr '+file["offset"]+'- '+file["url"]);

            child.stdout.on('data', function (data) {
                if (data.search("416 Requested Range Not Satisfiable")==-1) {
                    //console.log(announcer+': ' + data);
                    //console.log(data.replace(/^\s+|\s+$/g, '').split("\n").length+" milestones for "+announcer);
                    data.replace(/^\s+|\s+$/g, '').split(/\n(?=v=)/).forEach(process_milestone);
                    datalength = byteCount(data);
                    console.log(announcer+' data size: '+datalength+' bytes');
                    //console.log(data);
                    //offset+=datalength;
                    db.announcers.update({name: announcer, "files.url": file["url"]}, {$inc: {"files.$.offset": datalength}});
                } else {
                    //console.log("no new content");
                    //console.log("no new milestones for "+announcer);
                }
            });

            child.stderr.on('data', function (data) {
              console.log('stderr: ' + data);
            });

            child.on('close', function (code) {
                if (code>0) {console.log('logfile fetch for '+file["url"]+' exited with code ' + code);}
            });
        }
    });});
    if (timers[announcer]) {
    	clearTimeout(timers[announcer]);
    }
    timers[announcer] = setTimeout(
		function(){
    		console.log("checking "+announcer+" logs (2 min timer)");
    		get_server_logs(announcer)
    	},
    	120*1000
    );
}

function process_milestone(milestone) {
    milestone = milestone.replace("\n","");//for very long milestones that were split
    //if (!milestone.match(/name=(\w*):/)) {return;}// make sure it's a milestone
    try {
        var name = milestone.match(/name=(\w*):/)[1];
        var version = milestone.match(/v=(.*):vlong/)[1];
//         var xl = milestone.match(/xl=(\d+):/)[1];
//         var combo = milestone.match(/char=(\w\w\w\w):/)[1];
//         var text = milestone.match(/milestone=(\w*)/)[1];
//         if (milestone.match(/oplace=/)) {
//             var place = milestone.replace('::',';;').match(/oplace=([^:]*):/)[1].replace(';;',':');
//         } else {
//             var place = milestone.replace('::',';;').match(/place=([^:]*):/)[1].replace(';;',':');
//         }
        //var message = name+' (L'+xl+' '+combo+') '+text+' ('+place+')';
    } catch(error) {
        console.log(error);
        console.log("in milestone: "+milestone)
        return;
    }
    //console.log("milestone for "+name+" ("+version+")");
    //console.log(message);
    if (milestone.match(/v=0.16-a/) && !milestone.match(/god=(Ru|Gozag)/)) {//trunk only for csdc, Ru and Gozag not allowed
        db.nick_aliases.distinct('aliases',{"name":"csdc"},function(err, aliases){
            if (milestone.search(new RegExp("name=("+aliases[0]+"):", "i"))>-1){
                //go through active weeks with the name and return only data for that player (+general data)
                db.csdc.find({"active":true}, 
                    {"players": {$elemMatch: {"name":name.toLowerCase()}},
                        "char":1,
                        gods:1,
                        bonusqual:1,
                        bonusdisqual:1,
                        bonusworth:1,
                        week:1,
                        start:1,
                        end:1
                    }
                ).forEach(function(err, week) {
                    //console.log(JSON.stringify(week));
                    timeStamp = getTimeStamp();
                    //console.log(timeStamp);
                    if (week && timeStamp >= week["start"] && timeStamp < week["end"]) {
                        if (week['players'] && week['players'][0]) {
                            if (week['players'][0]['alive'] && milestone.search(new RegExp("char="+week["char"],"i"))>-1) {
                                //csdc_announce(name, milestone, week);
                                //console.log("name: "+alias+", message: "+message+", weekdata: "+JSON.stringify(week));
                                console.log("check csdc points for "+name+" in "+week["week"]);
                                //console.log(JSON.stringify(week));
                                check_csdc_points(name, milestone, week);
                            }
                        } else {
                            csdc_enroll(name, week, function(){
                                //week["players"] = [{"name": name, "points": [0, 0, 0, 0, 0, 0, 0],"bonusdisqual":[], "runes": 0, "alive": true, "tries": 0}];
                                //csdc_announce(name, message, week);
                                console.log("enrolled "+name+" into csdc "+week["week"]);
                                
                            });
                        }
                        //console.log(milestone);
                    }
                });
            }
        });
    }
}

function check_csdc_points(name, milestone, week) {
    console.log(milestone);
    player = week["players"][0];
    points = player["points"];
    xl = parseInt(milestone.match(/xl=(\d+):/i)[1]);
    ch = milestone.match(/char=(\w\w\w\w):/i)[1];
    if (milestone.match(/god=([^:]+):/i)) {
        god = milestone.match(/god=([^:]+):/i)[1];
    } else {
        god = "No God";
    }
    
    //0   Go directly to D:1, do not pass char selection, do not collect points
    if (milestone.search(/ktyp=/i)>-1 && !(milestone.search(/ktyp=winning/i)>-1)) {
        //get the xl
        xl = parseInt(milestone.match(/xl=(\d+):/i)[1]);
        //bot.say('##csdc',name+" died at xl: "+xl);
        //one retry if xl<5
        db.csdc.findOne({"week":week["week"], "players": {$elemMatch: {"name":name.toLowerCase(), "tries": 0}}}, function(err, found) {
            if (found && xl<5){
                db.csdc.update({"week":week["week"], "players": {$elemMatch: {"name":name.toLowerCase(), "tries": 0, "alive": true}}},{$set: {"players.$.tries":1}}, function (err, updated) {
                    if (updated["n"]>0) {
                        bot.say('##csdc', irc.colors.wrap('dark_blue', name+' has died at XL<5 and is eligible to redo the '+week["week"]+' challenge'));
                    }
                });
                //console.log(name+" died at xl<5");
            } else {
                db.csdc.update({"week":week["week"], "players": {$elemMatch: {"name":name.toLowerCase(), "alive": true}}}, {$set: {"players.$.alive":false}}, function(err, updated) {
                    if (updated["n"]>0) {
                        bot.say('##csdc', irc.colors.wrap('light_blue', name+'\'s final score for '+week["week"]+': '+points.reduce(function(a,b,i){return a+b;},0)));
                    }
                });
                //console.log(name+" is out");
            }
        });
        if (xl>4) {
            db.csdc.update({"week":week["week"], "players": {$elemMatch: {"name":name.toLowerCase(), "alive": true}}}, {$set: {"players.$.alive":false}}, function(err, updated) {
                if (updated["n"]>0) {
                    bot.say('##csdc', irc.colors.wrap('light_blue', name+'\'s final score for '+week["week"]+': '+points.reduce(function(a,b,i){return a+b;},0)));
                }
            });
        }
    }
    
    //1   Kill a unique:
    if (milestone.search(/type=uniq:milestone=killed/i)>-1){
        if (points[0]==0){
            //because they could kill uniques in rapid succession I need to check that they don't have that point in the database
            db.csdc.update({"week":week["week"], "players": {$elemMatch: {"name":name.toLowerCase(), "points.0": 0}}},{$set: {"players.$.points.0":1}}, function(err, updated){
                if (updated["n"]>0) {
                    uniqname = milestone.match(/milestone=killed ([^\.]*)\./)[1];
                    bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') killed '+uniqname+' for 1 point!'));
                }
            });
        }
    }
    
    //2   Enter a multi-level branch of the Dungeon:
    if (milestone.search(/type=br.enter/i)>-1 && !(milestone.search(/br=(icecv|volcano|lab|bailey|sewer|bazaar|ossuary|wizlab|trove|temple)/i)>-1)){
        if (points[1]==0){
            branch = milestone.match(/milestone=entered the ([^\.]*)\./)[1];
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') entered the '+branch+' for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.1":1}});
        }
    }
    
    //3   Reach the end of any multi-level branch (includes D):
    if (milestone.search(/type=br.end/)>-1){
        if (points[2]==0){
            branch = milestone.match(/milestone=reached level \d+ of the ([^\.]*)\./)[1];
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') finished the '+branch+' for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.2":1}});
        }
    }
    
    //4   Champion a listed god (from weekly list):
    //console.log(new RegExp("Champion of ("+week["gods"]+")")); // <= correct
    if (milestone.search(/type=god.maxpiety/)>-1 && milestone.search(new RegExp("god=("+week["gods"]+")","i"))>-1){
        if (points[3]==0 && !player["godabandon"]){
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') championed a weekly god ('+god+') for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.3":1}});
        }
    }
    // if they abandon then they lose the point, also it must be their first god to get the point
    if (milestone.search(/type=god.renounce/)>-1){
        if (points[3]==1){
            bot.say('##csdc', irc.colors.wrap('dark_red', name+' (L'+xl+' '+ch+') abandoned a weekly god ('+god+') and lost their point for championing'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.3":0}});
        }
        db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.godabandon":true}});
    }
    
    //5   Collect a rune:
    //6   Collect 3 or more runes in a game:
    if (milestone.search(/type=rune/)>-1){
        //db.csdc.update({"players.name":name.toLowerCase()},{$inc: {"players.$.runes":1}});
        if (points[4]==0){
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') found their first rune for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.4":1}});
        }
        //csdcdata[csdcwk]['playerdata'][lowername][4]+=1;
        //have at least 3 runes
        if (milestone.search(/urune=(\d\d|[3456789])/)>-1 && points[5]==0){
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') found their third rune for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.5":1}});
        }
    }
    
    //7   Win a game
    if (milestone.search(/ktyp=winning/)>-1){
        if (points[6]==0){
            bot.say('##csdc', irc.colors.wrap('light_blue', name+' (L'+xl+' '+ch+') has won a game for 1 point!'));
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.points.6":1}});
            db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: {"players.$.alive":false}});
            bot.say('##csdc', irc.colors.wrap('light_blue', name+'\'s final score for '+week["week"]+': '+points.reduce(function(a,b,i){return a+b;},1)+" points"));//+1 for the win point
        }
    }
    
    //8,9,etc tier bonus points
    for (i=0;i<week["bonusworth"].length;i++) {
        //disqualify (only if not already obtained)
        if (!points[i+7] && milestone.search(week["bonusdisqual"][i])>-1){
            if (!player["bonusdisqual"][i]){
                toset = {};
                toset["players.$.bonusdisqual."+i] = true;
                toset["players.$.points."+(i+7)] = 0;
                db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: toset});
                bot.say('##csdc', irc.colors.wrap('dark_red', name+' (L'+xl+' '+ch+') can no longer get the tier '+(i+1)+' bonus for '+week["week"]));
            }
        }
        //qualify
        if ((player["bonusdisqual"]==[] || !player["bonusdisqual"][i]) && milestone.search(week["bonusqual"][i])>-1){
            if (!points[i+7]){
                toset = {};
                toset["players.$.points."+(i+7)] = week["bonusworth"][i];
                db.csdc.update({"week":week["week"], "players.name":name.toLowerCase()},{$set: toset});
                bot.say('##csdc', irc.colors.wrap('dark_green', name+' (L'+xl+' '+ch+') has acquired the tier '+(i+1)+' bonus for '+week["week"]+', '+week["bonusworth"][i]+(week["bonusworth"][i]==1 ? ' point!' : ' points!')));
            }
        }
    }
}

function update_aliases(nick) {
    bot.say(sequell, ".echo nick-alias:"+nick+":$(join ' NAJNR' (split ' ' (nick-aliases "+nick+")))");
}

function csdc_enroll(name, week, callback) {
    //csdc_checkdeaths(name, week);
    //check if the alias is in the csdc doc for that week and add otherwise
    db.csdc.update({"week": week["week"], "players": {$not: {$elemMatch: {"name":name.toLowerCase()}}}},
        {$addToSet: {"players": {
            "name": name.toLowerCase(),
            "points": [
                0,
                0,
                0,
                0,
                0,
                0,
                0
            ],
            "bonusdisqual":[],
            "godabandon": false,
            "alive": true,
            "tries": 0
        }}},
        {multi:true}, callback);
}

function csdc_announce(name, message, week) {
    //should only be one player in the week doc
    player = week['players'][0];
    points = player['points'];
    //console.log("checking csdc for "+player["name"]+" <=> "+name);
    
    //check that they have the right char and are in the game still for this week
    if (!(player["alive"] && message.search(new RegExp("\\(L\\d+ "+week["char"]+"\\)","i"))>-1)) {
        return;
    }
    
    //announce the message if they are alive and the right char, then check points after
    announce_with_filters("##csdc", message/*, function(){check_csdc_points(name, message, week)}*/);
}

function announce_with_filters(chan, message, callback) {
    //get the regexes that it must match
    db.channels.distinct('filters',{channel:chan},function(err, matches) {
        var matched = true;
        matches.forEach(function(match) {
            if (message.search(match)==-1){
                matched = false;
            }
        });
        if (matched){
            //there should only be one colourmap per channel, could just use findOne() and colourmap = doc["colourmap"] here
            db.channels.distinct('colourmap',{'channel':chan},function(err, colourmaps) {
                var colour = 'gray';
                var colourmap = colourmaps[0];
                for (match in colourmap) {
                    if (message.search(match)>-1) {
                        colour = colourmap[match];
                    }
                }
                bot.say(chan, irc.colors.wrap(colour, message));
                if (callback) {callback();}
            });
        }
    });
}

function route_announcement(name, alias, message) {
    //go through the channels with the name
    db.channels.distinct('channel',{"names":{$in: [name]}}, function(err, chans) {chans.forEach(function(ch) {
        if (ch=='##csdc' && csdcrunning) {
            db.csdc.find({"active":true}, 
                {"players": {$elemMatch: {"name":alias.toLowerCase()}},
                    "char":1,
                    gods:1,
                    bonusqual:1,
                    bonusdisqual:1,
                    bonusworth:1,
                    week:1,
                    start:1,
                    end:1
                }
            ).forEach(function(err, week) {
                //console.log(JSON.stringify(week));
                timeStamp = getTimeStamp();
                //console.log(timeStamp);
                if (week && timeStamp >= week["start"] && timeStamp < week["end"]) {
                    if (week['players'] && week['players'][0]) {
                        csdc_announce(name, message, week);
                            //console.log("name: "+alias+", message: "+message+", weekdata: "+JSON.stringify(week));
                    }// else {
//                         csdc_enroll(name, week, function(){
//                             week["players"] = [{"name": name, "points": [0, 0, 0, 0, 0, 0, 0],"bonusdisqual":[], "runes": 0, "alive": true, "tries": 0}];
//                             csdc_announce(name, message, week);
//                         });
//                     }
                }
            });
        }
        
        if (ch!="##csdc") {
            announce_with_filters(ch, message);
        }
    });});
}

function do_command(arg, chan, nick, admin) {
    // commands
    if (arg[0]=="help" || arg[0]=="commands"){
        bot.say(control_channel, "Kramell commands:");
        if (admin) bot.say(chan, "  $announcer [-rm] <announcer name>");
        if (admin) bot.say(chan, "  $channel [-rm] <channel name>");
        bot.say(chan, "  $name [-rm] <channel name> <user name>");
        bot.say(chan, "  $filter [-rm] <channel name> <regex filter>");
        bot.say(chan, "  $colour [-rm] <channel name> [colour (if not -rm)] <regex filter>");
    }

    if (admin && (arg[0]=="announcer" || arg[0]=="announcers")){
        //get announcers
        db.announcers.distinct('name', function(err, ann){
            if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                if (arg[1]=="-rm"){// arg[2] is the announcer to remove
                    db.announcers.remove({'name':arg[2]});
                    bot.say(control_channel, "announcer removed ("+chan+"/"+nick+"): "+arg[2]);
                } else if (ann.indexOf(arg[1])==-1){// arg[1] is the announcer to add
                    db.announcers.insert({"name":arg[1], "files": []});
                    bot.say(control_channel, "announcer added ("+chan+"/"+nick+"): "+arg[2]);
                } 
            } else if (arg.length==1) {
                bot.say(chan, "announcers: "+ann.join(', '));
            } else {
                bot.say(chan, "Usage: !announcer [-rm] <announcer name>");
            }
        });
    }
    
    if (admin && arg[0]=="logfile") {
        if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                db.announcers.update({"name": arg[2]}, {$pull: {"files": {"url": arg[3]}}});
            } else {
                db.announcers.update({"name": arg[1]}, {$addToSet: {"files": {"url": arg[2]}}});
                get_logfile_offset(arg[1], arg[2]);
            }
        } else {
            bot.say(control_channel, "Usage: !logfile [-rm] <announcer name> <url>");
        }
    }

    if (admin && (arg[0]=="channel" || arg[0]=="channels")){
        db.channels.distinct('channel', function(err, chans){
            if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                if (arg[1]=="-rm"){
                    if (chans.indexOf(arg[2])>-1){// remove and part from channel arg[2]
                        bot.part(arg[2],'',null);
                        db.channels.remove({'channel':arg[2]});
                    } else {
                        bot.say(chan, "No such channel");
                    }
                } else if (forbidden.indexOf(arg[1])==-1) {
                    if (chans.indexOf(arg[1])>-1){
                    } else {// add and join channel arg[1]
                        db.channels.insert({"channel": arg[1], "names": [], "filters": [], "colourmap": {"[\\w]*": "gray"}});
                        bot.join(arg[1],null);
                    }
                } else {
                    bot.say(chan, "Sorry, I don't allow that channel");
                }
            } else if (arg.length==1) {
                bot.say(chan, "channels: "+chans.join(', '));
            } else {
                bot.say(chan, "Usage: !channel [-rm] <channel name>");
            }
        });
    }

    if (arg[0]=="name" || arg[0]=="names"){
        //db.channels.find({},{"channel":1,"names":1,_id:0})
        if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                argchan = arg[2];
                argname = arg[3];
                db.channels.update({"channel":argchan},{$pull: {"names":argname}});
                bot.say(control_channel, "name removed ("+chan+"/"+nick+"): "+argname+" from "+argchan);
            } else {
                argchan = arg[1];
                argname = arg[2];
                db.channels.update({"channel":argchan},{$addToSet: {"names":argname}});
                update_aliases(argname);
                bot.say(control_channel, "name added ("+chan+"/"+nick+"): "+argname+" to "+argchan);
            }
        } else if (arg.length==2) {
            db.channels.distinct('names', {'channel':arg[1]}, function(err, names) {
                bot.say(chan, "Names in "+arg[1]+": "+names.join(', '));
            });
        } else {
            bot.say(chan, "Usage: !name [-rm] <channel name> <user name>");
        }
    }

    if (arg[0]=="filter" || arg[0]=="filters"){
        if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                //arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[2];
                argfilter = arg[3];
                db.channels.update({"channel":argchan},{$pull: {"filters":argfilter}});
                bot.say(control_channel, "filter removed ("+chan+"/"+nick+"): "+argfilter+" from "+argchan);
            } else {
                //arg[2] = arg.slice(2, arg.length).join(' ');
                argchan = arg[1];
                argfilter = arg[2];
                db.channels.update({"channel":argchan},{$addToSet: {"filters":argfilter}});
                bot.say(control_channel, "filter added ("+chan+"/"+nick+"): "+argfilter+" to "+argchan);
            }
        } else if (arg.length==2) {
            db.channels.distinct('filters', {'channel':arg[1]}, function(err, filters) {
                bot.say(chan, "Filters for "+arg[1]+": "+filters.join(', '));
            });
        } else {
            bot.say(chan, "Usage: !filter [-rm] <channel name> <regex filter>");
        }
    }
  
    if (arg[0]=="colour" || arg[0]=="color" || arg[0]=="colours" || arg[0]=="colors"){
        if (arg.length>4 || (arg.length==4 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                //arg[4] = arg.slice(4, arg.length).join(' ');
                argchan = arg[2];
                argcolour = arg[3];
                argfilter = arg[4];
                toremove = {}
                toremove["colourmap."+argfilter] = argcolour;
                //console.log("removing "+toremove);
                db.channels.update({"channel":argchan},{$unset: toremove});
            } else {
                //arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[1];
                argcolour = arg[2];
                argfilter = arg[3];
                toinsert = {}
                toinsert["colourmap."+argfilter] = argcolour
                //console.log("adding "+toinsert);
                db.channels.update({"channel":argchan},{$set: toinsert});
            }
        } else if (arg.length==2) {
            db.channels.distinct('colourmap', {'channel':arg[1]}, function(err, colourmap) {
                bot.say(chan, "Colouring filters for "+arg[1]+": "+JSON.stringify(colourmap));
            });
        } else {
            bot.say(chan, "Usage: !colour [-rm] <channel name> <colour> <regex filter>");
        }
    }
    
    if ((arg[0]=="colors" || arg[0]=="colours") && arg.length==1) {
        bot.say(chan, "Allowed colours: white, black, dark_blue, dark_green, light_red, dark_red, magenta, orange, yellow, light_green, cyan, light_cyan, light_blue, light_magenta, gray, light_gray");
    }
    
    if (admin && arg[0]=="csdcon") {
        if (arg.length>1) {
            //arg[1] = arg.slice(1, arg.length).join(' ');
            db.csdc.update({"week":arg[1]},{$set: {"active":true}}, function(err, updated) {
                //console.log(updated);
                if (updated["n"]>0) {
                    bot.say(chan, arg[1]+' on');
                }
            });
        } else {
            csdcrunning = true;
            bot.say(chan, 'csdc on');
        }
    }
    
    if (admin && arg[0]=="csdcoff") {
        if (arg.length>1) {
            //arg[1] = arg.slice(1, arg.length).join(' ');
            db.csdc.update({"week":arg[1]},{$set: {"active":false}}, function(err, updated) {
                if (updated["n"]>0) {
                    bot.say(chan, arg[1]+' off');
                }
            });
        } else {
            csdcrunning = false;
            bot.say(chan, 'csdc off');
        }
    }
    
    if (admin && arg[0]=="csdcweek") {
        if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                //arg[2] = arg.slice(2, arg.length).join(' ');
                db.csdc.remove({"week":arg[2]}, function(err, numberRemoved) {
                    //console.log(numberRemoved);
                    if (numberRemoved["n"]>0) {
                        bot.say(chan, arg[2]+" Removed");
                    }
                });
            } else {
                //arg[1] = arg.slice(1, arg.length).join(' ');
                db.csdc.findOne({"week":arg[1]}, function(err,week) { 
                    if (week) {
                        bot.say(chan, week["week"] +" active: "+week["active"]+(week["active"] ? " (from "+week["start"]+" to "+week["end"]+")" : ""));
                        bot.say(chan, week["week"] +" char: "+week["char"]);
                        bot.say(chan, week["week"] +" gods: "+week["gods"]);
                        //bot.say(chan, "Week "+week["week"] +" t1qual: "+week["t1qual"]);
                        //bot.say(chan, "Week "+week["week"] +" t1disqual: "+week["t1disqual"]);
                        //bot.say(chan, "Week "+week["week"] +" t2qual: "+week["t2qual"]);
                        //bot.say(chan, "Week "+week["week"] +" t2disqual: "+week["t2disqual"]);
                    } else {
                        db.csdc.insert({
                            "week": arg[1],
                            "active": false,
                            "announced": false,
                            "start": 20141002,
                            "end": 20141025,
                            "char": "^$",
                            "gods": "^$",
                            "players": [],
                            "bonusqual":[],
                            "bonusdisqual":[],
                            "bonusworth":[],
                            "bonustext":[]
                        }, function(err,inserted) {
                            bot.say(chan, arg[1]+" Added");
                        });
                    }
                });
            }
        } else {
            bot.say(chan, "Usage: !csdcweek [-rm] <week name>");
        }
    }
    
    if (admin && arg[0]=="csdcset") {
        if (arg.length>3 && (arg[1]=="char" || arg[1]=="gods" || arg[1]=="start" || arg[1]=="end")) {
            //arg[3] = arg.slice(3, arg.length).join(' ');
            //arg[2] = arg[2].replace(/_/g,' ');
            if (arg[1]=="start" || arg[1]=="end") {
                arg[3] = parseInt(arg[3]);
            }
            toset = {};
            toset[arg[1]] = arg[3];
            db.csdc.update({"week":arg[2]},{$set: toset}, function(err, updated) {
                //console.log(updated);
                if (err) {
                    bot.say(chan, err);
                }
                if (updated["n"]>0) {
                    bot.say(chan, arg[2]+" "+arg[1]+": "+arg[3]);
                }
            });
        } else if (arg.length>4 && arg[1]=="bonustext") {
        	toset={};
        	toset["bonustext."+arg[3]] = arg[4];
        	db.csdc.update({"week":arg[2]},{$set: toset}, function(err, updated) {
                if (err) {
                    bot.say(chan, err);
                }
                if (updated["n"]>0) {
                    bot.say(chan, arg[2]+" "+arg[1]+" "+arg[3]+": "+arg[4]);
                }
            });
        } else if (arg.length>6 && arg[1]=="bonus") {
            toset={};
            toset["bonusworth."+arg[3]] = parseInt(arg[4]);
            toset["bonusqual."+arg[3]] = arg[5];
            toset["bonusdisqual."+arg[3]] = arg[6];
            db.csdc.update({"week":arg[2]},{$set: toset}, function(err, updated) {
                if (err) {
                    bot.say(chan, err);
                }
                if (updated["n"]>0) {
                    bot.say(chan, arg[2]+" "+arg[1]+" "+arg[3]+" points: "+arg[4]+", qual: "+arg[5]+", disqual: "+arg[6]);
                }
            });
        } else {
            bot.say(chan, "Usage: !csdcset <char|gods|start|end|bonus|bonustext> <week name> <[char]|[god regex]|[start]|[end](YYYYMMDD)|[num] [worth] [qual] [disqual]|[num] [text]>");
        }
    }
    
    if (admin && arg[0]=="rejoin") {
        db.channels.distinct('channel',function(err, chans) {chans.forEach(function(chan){
            bot.join(chan,null);
        });});
    }
}

function announce_week(week, chan) {
	//console.log(JSON.stringify(week));
	//console.log("announcing "+week["week"]);
	bot.say(chan, irc.colors.wrap('magenta', "Char: "+week["char"]));
	bot.say(chan, irc.colors.wrap('magenta', "Gods: "+week["gods"].replace(/\|/g,', ')));
	//console.log(week["bonustext"].length+" bonusses: "+JSON.stringify(week["bonustext"]));
	for (i=0; i<week["bonustext"].length; i++) {
		//console.log("announcing bonus "+i);
		bot.say(chan, irc.colors.wrap('magenta', "Tier "+(i+1)+" bonus: "+week["bonustext"][i]));
	}
}

function handle_message(nick, chan, message) {
	if (chan==botnick && nick!=chei && nick!=sequell) {chan=nick;}
	
    if(  message.indexOf('Hello '+botnick) > -1
    ) {
        bot.say(chan, 'Hello!');
    }

    // get announcements
    if (chan == observe_channel || chan == control_channel){//remove control_channel when all working
        //check if from announcer
        db.announcers.count({"name":nick},function(err, count){ if (count) {
        	//do CSDC weekly combo announcement
			db.csdc.findOne({"announced": false}, {"week": 1, "start": 1, "char": 1, "gods": 1, "bonustext": 1}, function(err, week) {
				//if (week) console.log("checking date for "+week["week"]+", "+getTimeStamp()+">="+week["start"]);
				if (week && getTimeStamp() >= week["start"]) {
					db.csdc.update({"week": week["week"]},{$set: {"announced": true}});
					bot.say('##csdc', irc.colors.wrap('magenta', week["week"]+" has begun!"));
					announce_week(week, '##csdc');
				}
			});
			
            get_server_logs(nick);
            
            //console.log("found announcement");
            // go through all names in all channels
            db.channels.distinct('names',function(err, names) {names.forEach(function(name) {
                //get aliases
                db.nick_aliases.distinct('aliases',{"name":name.toLowerCase()},function(err, alias){
                    alias=alias[0] ? alias[0] : name;
                    //get the actual alias in use and announce
                    if (message.search(new RegExp("^("+alias+") ", "i"))>-1){
                        alias = message.match(new RegExp("^("+alias+") ", "i"))[1];
                        //console.log("announcement for "+alias);
                        route_announcement(name, alias, message);
                    }
                });
            });});
        }});
    }
    
    // redirect sequell/chei queries
    // if in a post channel
    db.channels.count({"channel":chan},function(err, count){ if (count) {
        if (message[0] == '%'){
            bot.say(chei, message);
            cheiquerychan = chan;
        }
//         if (message.indexOf("!tell")==0 || message.indexOf("!messages")==0) {
//             bot.say(chan, "Can't use this command in here, sorry");
//         } else 
        if ('!=&.?@^'.indexOf(message[0])>-1){
            bot.say(sequell, "!RELAY -n 1 -channel ##crawl -nick "+nick+" -prefix "+chan+":"+" "+message);;
        }
    }});
    
    // post sequell answers
    if (chan == botnick && nick == sequell){
        msgarray = message.split(':');
        var updateNA = false;
        if (msgarray.length>2 && msgarray[0]=="nick-alias"){
            NAnick = msgarray[1];
            NAaliases = msgarray[2].replace(/ NAJNR/g,'|').replace('\r\n','');
            for (i=4; i<msgarray.length; i+=2){
                NAaliases = NAaliases+'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
            }
            bot.say(control_channel, "nick mapping: "+NAnick+" => "+NAaliases)
            updateNA=true;
        } else if (message.search(/^NAJNR/)>-1){
            for (i=0; i<msgarray.length; i+=2){
                NAaliases = NAaliases +'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
                bot.say(control_channel, "...|"+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n',''));
            }
            updateNA=true;
        } else if (msgarray.length>1 && msgarray[0][0]=="#"){
            msgarray[1] = msgarray.slice(1, msgarray.length).join(':');
            if (msgarray[1].slice(0,4)=="/me ") {
                bot.action(msgarray[0], msgarray[1].slice(4, msgarray[1].length));
            } else {
                bot.say(msgarray[0], msgarray[1].replace("This command cannot be used in PM", "This Sequell command cannot be used in here"));
            }
        }
        if (updateNA) {
            //add new after clearing
            db.nick_aliases.remove({"name":NAnick.toLowerCase()},function(err) {
                db.nick_aliases.insert({"name":NAnick.toLowerCase(), "aliases":NAaliases});
            });
        }
    }
    
    //post chei answers
    if (chan == botnick && nick == chei){
        bot.say(cheiquerychan, message);
    }
    
    //kramell csdc queries (use $ or #)
    if ('$#'.indexOf(message[0])>-1) {
        //remove prefix and add username as first arg if there is none
        var arg = message.slice(1, message.length).replace(/ \. /g," "+nick+" ").replace(/ \.$/," "+nick).split(' ');
        if (arg.length==1){
            arg[1]=nick;
        }
        
        if (arg[0]=="help") {
            bot.say(chan, "csdc commands: $points <player>, $week <week num>");
        }
        
        if (arg[0]=="points") {
            //build pstr backwards
            var pstr = "Points for "+arg[1]+": ";
            var s = [];
            var first=true;
            db.csdc.find({},{"players": {$elemMatch: {"name":new RegExp(arg[1], "i")}}, week:1}, function(err, weeks) {
                weeks.forEach(function(week) {
                        if (week && week["players"] && week["players"][0] && week["week"].match(/(\d+)/)) {
                            s[week["week"].match(/(\d+)/)[1]] = week["week"]+(week["players"][0]["alive"] ? " (in prog.)" : "")+": "+week["players"][0]['points'].reduce(function(a,b,i){return a+b;},0);
                        }
                });
                for (i=0; i<s.length; i++) {
                    if (s[i]) {
                        if (!first) {pstr += " | ";}
                        pstr+=s[i];
                        first=false;
                    }
                }
                bot.say(chan, pstr);
            });
        }
        
        if (arg[0]=="scoreboard" || arg[0]=="scorepage") {
            bot.say(chan, "http://rob.pecknology.net/csdc/");
        }
        
        if (arg[0]=="info" || arg[0]=="week") {
			db.csdc.findOne({"week": new RegExp(arg.slice(1,arg.length),"i"), "start": {$lte: getTimeStamp()}}, {"week": 1, "start": 1, "char": 1, "gods": 1, "bonustext": 1}, function(err, week) {
				if (week) {
					//bot.say(chan, irc.colors.wrap('magenta', "CSDC "+week["week"]);
					announce_week(week, chan);
				}
			});
        }
        
        if (arg[0]=="slap") {
            bot.action(chan, "slaps "+arg.slice(1, arg.length).join(' ')+" around a bit with a large trout");
        }
        
        if (arg[0]=="dance" && chan!="##crawl") {
            bot.say(chan, ":D|-<");
            setTimeout(function(){bot.say(chan, ":D\\-<");}, 300);
            setTimeout(function(){bot.say(chan, ":D/-<");}, 500);
            setTimeout(function(){bot.say(chan, ":D\\-<");}, 700);
        }
        
        //if (arg[0]=="testpm") {
        //    bot.say(arg[1], arg.slice(2, arg.length));
        //}
    }

    if (chan!=observe_channel && '$#'.indexOf(message[0])>-1){
        //remove prefix and handle " "
        arg = message.slice(1, message.length).trim().split('\"');
        arg = arg.map(function(val,index) {return index%2==0 ? val : val.replace(/ /g, 'SPCSPCSPC');});
        arg = arg.join('').split(' ');
        arg = arg.map(function(val,index) {return val.replace(/SPCSPCSPC/g, ' ');});
        //arg = [].concat.apply([], arg);
        console.log(arg);
        admin = chan==control_channel;
        do_command(arg, chan, nick, admin);
    }
}

function handle_error(error) {
    console.log(error);
}

function handle_quit(nick, reason, channels, message) {
	console.log("QUIT: "+nick+"; "+reason+"; "+channels+"; "+message);
}

function handle_connect(message) {
    console.log(message);
    console.log("Logging in with nick: "+botnick+", pass: "+password);
    bot.say("NickServ", "identify "+password);
}

//connect to IRC
db.channels.distinct('channel',function(err, chans) {
    //bot.join(chan,null);
    bot = new irc.Client('chat.freenode.net', botnick, {
        channels: [control_channel,observe_channel].concat(chans),
        port: 8001,
        debug: true,
//        sasl: true,
        userName: botnick
//        password: password
    });
    bot.addListener('message', handle_message);
    bot.addListener('error', handle_error);
    bot.addListener('quit', handle_quit);
    bot.addListener('registered', handle_connect);
});

//end IRC bot

function nop(){}

//  OpenShift sample Node application

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
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_INTERNAL_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        // Routes for /health, /asciimo and /
        self.routes['/health'] = function(req, res) {
            res.send('1');
        };

        self.routes['/asciimo'] = function(req, res) {
            var link = "http://i.imgur.com/kmbjB.png";
            res.send("<html><body><img src='" + link + "'></body></html>");
        };

        self.routes['/'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('index.html') );
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
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

