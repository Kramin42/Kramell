#!/bin/env node

//
// Author: Cameron Dykstra
// Email: dykstra.cameron@gmail.com

var express = require('express');
var fs      = require('fs');

// IRC bot
var botnick = 'Kramell';
var chei = 'Cheibriados';
var sequell = 'Sequell';
var irc = require('irc');
var observe_channel = "##crawl";
var bot;


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

var cheiquerychan = control_channel;
var sequellquerychan = control_channel;

function check_csdc_points(name, message, csdcwk) {
    var lowername = name.toLowerCase();
    var save = false;
    if (!(lowername in csdcdata[csdcwk]['playerdata'])){
        csdcdata[csdcwk]['playerdata'][lowername]=[0,0,0,0,0,0,0,0,0];
        //console.log('added '+name+' to '+csdcwk);
        save = true;
    }
    //1   Kill a unique:
    if (message.search(/\) killed/)>-1 && !(message.search(/the ghost/)>-1) && !(message.search(/with \d+ points after \d+ turns/)>-1)){
        if (csdcdata[csdcwk]['playerdata'][lowername][0]==0){
            csdcdata[csdcwk]['playerdata'][lowername][0]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has killed a unique for 1 point!'));
            save = true;
        }
    }
    
    //2   Enter a multi-level branch of the Dungeon:
    if (message.search(/entered the Depths|\((Lair|Orc):/)>-1){
        if (csdcdata[csdcwk]['playerdata'][lowername][1]==0){
            csdcdata[csdcwk]['playerdata'][lowername][1]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has entered a branch for 1 point!'));
            save = true;
        }
    }
    
    //3   Reach the end of any multi-level branch (includes D):
    if (message.search(/reached level/)>-1){
        if (csdcdata[csdcwk]['playerdata'][lowername][2]==0){
            csdcdata[csdcwk]['playerdata'][lowername][2]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has finished a branch for 1 point!'));
            save = true;
        }
    }
    
    //4   Champion a listed god (from weekly list):
    if (message.search("Champion of "+csdcdata[csdcwk]['wkgods'])>-1){
        if (csdcdata[csdcwk]['playerdata'][lowername][3]==0){
            csdcdata[csdcwk]['playerdata'][lowername][3]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has championed a weekly god for 1 point!'));
            save=true;
        }
    }
    
    //5   Collect a rune:
    //6   Collect 3 or more runes in a game:
    if (message.search(/rune of Zot/)>-1){
        if (csdcdata[csdcwk]['playerdata'][lowername][4]==0){
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has found a rune for 1 point!'));
        }
        csdcdata[csdcwk]['playerdata'][lowername][4]+=1;
        if (csdcdata[csdcwk]['playerdata'][lowername][4]>=3 && csdcdata[csdcwk]['playerdata'][lowername][5]==0){
            csdcdata[csdcwk]['playerdata'][lowername][5]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has found 3 runes for 1 point!'));
        }
        save = true;
    }
    
    //7   Win a game
    if (message.search(/escaped with the Orb/)>-1){
        if (csdcdata[csdcwk]['playerdata'][lowername][6]==0){
            csdcdata[csdcwk]['playerdata'][lowername][6]=1;
            bot.say('##csdc', irc.colors.wrap('light_green', name+' has won a game for 1 point!'));
            save = true;
        }
    }
    
    if (save) {
        fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/csdcdata', JSON.stringify(csdcdata), function (err) {
            if (err) throw err;
        });
    }
}

function update_aliases(nick) {
    bot.say(sequell, ".echo nick-alias:"+nick+":$(join ' NAJNR' (split ' ' (nick-aliases "+nick+")))");
}

// function nick_aliases(nick) {
//     aliases = db.nick_aliases.distinct('aliases',{name:"Kramin"});
//     return aliases ? aliases : nick;
// }

function announce(name, alias, message) {
    //go through the channels with the name
    db.channels.distinct('channel',{names:{$in: [name]}}, function(err, chans) {chans.forEach(function(ch) {
        if (ch=='##csdc' && csdcrunning) {
    //                             for (var csdcwk in csdcdata) {
    //                                 if (csdcdata.hasOwnProperty(csdcwk)){
    //                                     //console.log("checking for char:"+new RegExp("L\d+ "+csdcdata[csdcwk]["wkchar"]));
    //                                     //console.log("char match: "+message.search(new RegExp("L\d+ "+csdcdata[csdcwk]["wkchar"])));
    //                                     if (csdcdata[csdcwk]["active"] && message.search("\\(L\\d+ "+csdcdata[csdcwk]["wkchar"]+"\\)")>-1){
    //                                         //console.log("checking points for "+name);
    //                                         check_csdc_points(bot, alias, message, csdcwk);
    //                                     }
    //                                 }
    //                             }
        }
        
        //get the regexes that it must match
        db.channels.distinct('filters',{channel:ch},function(err, matches) {
            var matched = true;
            matches.forEach(function(match) {
                if (message.search(match)==-1){
                    matched = false;
                }
            });
            if (matched){
                //there should only be one colourmap per channel, could just use findOne() and colourmap = doc["colourmap"] here
                db.channels.distinct('colourmap',{'channel':ch},function(err, colourmaps) {
                    var colour = 'grey';
                    var colourmap = colourmaps[0];
                    for (match in colourmap) {
                        if (message.search(match)>-1) {
                            colour = colourmap[match];
                        }
                    }
                    bot.say(ch, irc.colors.wrap(colour, message));;
                });
            }
        });
    });});
}

function do_command(arg) {
    // commands
    if (arg[0]=="!help" || arg[0]=="!commands"){
        bot.say(control_channel, "commands:");
        bot.say(control_channel, "  !state");
        bot.say(control_channel, "  !announcer [-rm] <announcer name>");
        bot.say(control_channel, "  !channel [-rm] <channel name>");
        bot.say(control_channel, "  !name [-rm] <channel name> <user name>");
        bot.say(control_channel, "  !filter [-rm] <channel name> <regex filter>");
        bot.say(control_channel, "  !colour [-rm] <channel name> [colour (if not -rm)] <regex filter>");
    }

    if (arg[0]=="!announcer" || arg[0]=="!announcers"){
        //get announcers
        db.announcers.distinct('name', function(err, ann){
            if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                if (arg[1]=="-rm"){// arg[2] is the announcer to remove
                    db.announcers.remove({'name':arg[2]});
                } else if (ann.indexOf(arg[1])==-1){// arg[1] is the announcer to add
                    db.announcers.insert({"name":arg[1]});
                } 
            } else if (arg.length==1) {
                bot.say(control_channel, "announcers: "+ann.join(', '));
            } else {
                bot.say(control_channel, "Usage: !announcer [-rm] <announcer name>");
            }
        });
    }

    if (arg[0]=="!channel" || arg[0]=="!channels"){
        db.channels.distinct('channel', function(err, chans){
            if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                if (arg[1]=="-rm"){
                    if (chans.indexOf(arg[2])>-1){// remove and part from channel arg[2]
                        bot.part(arg[2],'',null);
                        db.channels.remove({'channel':arg[2]});
                    } else {
                        bot.say(control_channel, "No such channel");
                    }
                } else if (forbidden.indexOf(arg[1])==-1) {
                    if (chans.indexOf(arg[1])>-1){
                    } else {// add and join channel arg[1]
                        db.channels.insert({"channel": arg[1], "names": [], "filters": [], "colourmap": {"[\\w]*": "gray"}});
                        bot.join(arg[1],null);
                    }
                } else {
                    bot.say(control_channel, "Sorry, I don't allow that channel");
                }
            } else if (arg.length==1) {
                bot.say(control_channel, "channels: "+chans.join(', '));
            } else {
                bot.say(control_channel, "Usage: !channel [-rm] <channel name>");
            }
        });
    }

    if (arg[0]=="!name" || arg[0]=="!names"){
        //db.channels.find({},{"channel":1,"names":1,_id:0})
        if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                argchan = arg[2];
                argname = arg[3];
                db.channels.update({"channel":argchan},{$pull: {"names":argname}});
            } else {
                argchan = arg[1];
                argname = arg[2];
                db.channels.update({"channel":argchan},{$addToSet: {"names":argname}});
                update_aliases(argname);
            }
        } else if (arg.length==2) {
            db.channels.distinct('names', {'channel':arg[1]}, function(err, names) {
                bot.say(control_channel, "Names in "+arg[1]+": "+names.join(', '));
            });
        } else {
            bot.say(control_channel, "Usage: !name [-rm] <channel name> <user name>");
        }
    }

    if (arg[0]=="!filter" || arg[0]=="!filters"){
        if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
            if (arg[1]=="-rm"){
                arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[2];
                argfilter = arg[3];
                db.channels.update({"channel":argchan},{$pull: {"filters":argfilter}});
            } else {
                arg[2] = arg.slice(2, arg.length).join(' ');
                argchan = arg[1];
                argfilter = arg[2];
                db.channels.update({"channel":argchan},{$addToSet: {"filters":argfilter}});
            }
        } else if (arg.length==2) {
            db.channels.distinct('filters', {'channel':arg[1]}, function(err, filters) {
                bot.say(control_channel, "Filters for "+arg[1]+": "+filters.join(', '));
            });
        } else {
            bot.say(control_channel, "Usage: !filter [-rm] <channel name> <regex filter>");
        }
    }
  
    if (arg[0]=="!colour" || arg[0]=="!color" || arg[0]=="!colours" || arg[0]=="!colors"){
//        db.channels.distinct('channel', function(err, chans){
        if (arg.length>3){
            if (arg[1]=="-rm"){
                arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[2];
                argfilter = arg[3];
                toremove = {}
                toremove["colourmap."+argfilter] = argcolour;
                console.log("removing "+toremove);
                db.channels.update({"channel":argchan},{$unset: toremove});
            } else {
                arg[3] = arg.slice(3, arg.length).join(' ');
                argchan = arg[1];
                argcolour = arg[2];
                argfilter = arg[3];
                toinsert = {}
                toinsert["colourmap."+argfilter] = argcolour
                console.log("adding "+toinsert);
                db.channels.update({"channel":argchan},{$addToSet: toinsert});
            }
        } else if (arg.length==2) {
            db.channels.distinct('colourmap', {'channel':arg[1]}, function(err, colourmap) {
                bot.say(control_channel, "Colouring filters for "+arg[1]+": "+JSON.stringify(colourmap));
            });
        } else {
            bot.say(control_channel, "Usage: !colour [-rm] <channel name> [colour (if not -rm)] <regex filter>");
        }
//        });
    }
    
    if ((arg[0]=="!colors" || arg[0]=="!colours") && arg.length==1) {
        bot.say(control_channel, "Allowed colours: white, black, dark_blue, dark_green, light_red, dark_red, magenta, orange, yellow, light_green, cyan, light_cyan, light_blue, light_magenta, gray, light_gray");
    }
    
    if (arg[0]=="!csdc"){
        csdcrunning = !csdcrunning;
        if (csdcrunning){
            bot.say(control_channel, 'csdc on');
        } else {
            bot.say(control_channel, 'csdc off');
        }
    }
//     if (arg[0]=="!csdcwkon") {
//         if (arg[1] in csdcdata){
//             csdcdata[arg[1]]["active"] = true;
//             bot.say(control_channel, arg[1]+' on');
//         }
//     }
//     if (arg[0]=="!csdcwkoff") {
//         if (arg[1] in csdcdata){
//             csdcdata[arg[1]]["active"] = false;
//             bot.say(control_channel, arg[1]+' off');
//         }
//     }
//     if (arg[0]=="!csdcwk") {
//         if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
//             if (arg[1]=="-rm"){
//                 if (arg[2] in csdcdata){
//                     delete csdcdata[arg[2]];
//                     bot.say(control_channel, "csdc weeks: "+Object.keys(csdcdata));
//                 } else {
//                     bot.say(control_channel, "No such week");
//                 }
//             } else {
//                 if (arg[1] in csdcdata){
//                     bot.say(control_channel, "Week "+arg[1]+" active: "+csdcdata[arg[1]]["active"]);
//                     bot.say(control_channel, "Week "+arg[1]+" char: "+csdcdata[arg[1]]["wkchar"]);
//                     bot.say(control_channel, "Week "+arg[1]+" gods: "+csdcdata[arg[1]]["wkgods"]);
//                 } else {
//                     csdcdata[arg[1]]={"active":false,"wkchar":"....","wkgods":"\\w*","playerdata":{}};
//                     bot.say(control_channel, "csdc weeks: "+Object.keys(csdcdata));
//                 }
//             }
//         } else {
//             bot.say(control_channel, "Usage: !channel [-rm] <channel name>");
//         }
//     }
}

function handle_message(nick, chan, message) {
    if(  message.indexOf('Hello '+botnick) > -1
    ) {
        bot.say(chan, 'Hello!');
    }

    // get announcements
    if (chan == observe_channel || chan == control_channel){//remove control_channel when all working
        //check if from announcer
        db.announcers.count({"name":nick},function(err, count){ if (count) {
            //console.log("found announcement");
            // go through all names in all channels
            db.channels.distinct('names',function(err, names) {names.forEach(function(name) {
                //get aliases
                db.nick_aliases.distinct('aliases',{"name":name},function(err, alias){
                    alias=alias[0] ? alias[0] : name;
                    //get the actual alias in use and announce
                    if (message.search(new RegExp("^("+alias+") ", "i"))>-1){
                        alias = message.match(new RegExp("^("+alias+") ", "i"))[1];
                        console.log("announcement for "+alias);
                        announce(name, alias, message);
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
        if ('!=&.?@^'.indexOf(message[0])>-1){
            bot.say(sequell, message.replace(/ \. /g, ' @'+nick+' ').replace(/ \.$/, ' @'+nick));
            sequellquerychan = chan;
        }
    }});
    
    // post sequell answers
    if (chan == botnick && nick == sequell){
        msgarray = message.split(':');
        var updateNA = false;
        if (msgarray.length>2 && msgarray[0]=="nick-alias"){
            var NAnick = msgarray[1];
            var NAaliases = msgarray[2].replace(/ NAJNR/g,'|').replace('\r\n','');
            for (i=4; i<msgarray.length; i+=2){
                NAaliases = NAaliases+'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
            }
            bot.say(control_channel, "nick mapping: "+NAnick+" => "+NAaliases)
            updateNA=true;
        } else if (message.search(/^NAJNR/)>-1){
            //get existing first (don't need to actually, it will still be stored in NAaliases)
            //db.nick_aliases.findOne({"name":NAnick}, function(err, nickmap) {
                //NAaliases=nickmap["aliases"];
                for (i=0; i<msgarray.length; i+=2){
                    NAaliases = NAaliases +'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
                    bot.say(control_channel, "...|"+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n',''));
                }
                updateNA=true;
            //});
        } else {
            bot.say(sequellquerychan, message);
        }
        if (updateNA) {
            //add new after clearing
            db.nick_aliases.remove({"name":NAnick},function(err) {
                db.nick_aliases.insert({"name":NAnick, "aliases":NAaliases});
            });
        }
    }
    
    //post chei answers
    if (chan == botnick && nick == chei){
        bot.say(cheiquerychan, message);
    }
    
//     //kramell queries
//     //csdcdata format: {"csdc3wktest":{"active":true,"wkchar":"....","wkgods":"\\w*","playerdata":{}}}
//     if (message[0] == '#') {
//         var arg = message.replace(/ \. /g," "+nick+" ").replace(/ \.$/," "+nick).split(' ');
//         if (arg.length==1){
//             arg[1]=nick;
//         }
//         if (arg[0]=="#points") {
//             var pstr = "Points for "+arg[1]+": ";
//             var first=true
//             for (var csdcwk in csdcdata) { if (csdcdata.hasOwnProperty(csdcwk)){
//                 if (arg[1].toLowerCase() in csdcdata[csdcwk]["playerdata"]) {
//                     if (!first) {pstr+=", ";}
//                     pstr+=csdcwk+" "+csdcdata[csdcwk]["playerdata"][arg[1].toLowerCase()].reduce(function(a,b,i){return a+Math.min(1,b)+((i==8 && b>0) ? 1 : 0);},0);
//                     first=false;
//                 }
//             }}
//             bot.say(chan, pstr);
//         }
//     }
// 
// 
// 
    if (chan == control_channel && message[0]=='!'){
        var arg = message.split(' ');
        do_command(arg);
    }
}

bot = new irc.Client('chat.freenode.net', botnick, {
    channels: [control_channel,observe_channel],
    port: 8001,
    debug: true
});

db.channels.distinct('channel',function(err, chans) {chans.forEach(function(chan){
    bot.join(chan,null);
});});

bot.addListener('message', handle_message);

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

