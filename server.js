#!/bin/env node

var express = require('express');
var fs      = require('fs');

// IRC bot
var botnick = 'Kramell';
var chei = 'Cheibriados';
var sequell = 'Sequell';
var irc = require('irc');
var observe_channel = "##crawl";
var announcers = ["Henzell","Sizzell","Lantell","Rotatell","Gretell",'Kramin'];
var names = {'##crawl-sprigganrockhaulersinc': ['Kramin']};
var channels = ['##crawl-sprigganrockhaulersinc','##csdc'];
var control_channel = "##kramell";
var forbidden = ['##crawl','##crawl-dev','##crawl-sequell'];

var csdcdata = {"csdc3wktest":{"active":true,"wkchar":"....","wkgods":"\\w*","playerdata":{}}};
//var csdcwk = 'csdc3wktest';
var csdcrunning = true;

/*
   Weekly points (can be earned once per challenge):            
1   Kill a unique:                                           +1 pt
2   Enter a multi-level branch of the Dungeon:               +1 pt
3   Reach the end of any multi-level branch (includes D):    +1 pt
4   Champion a listed god (from weekly list):                +1 pt
5   Collect a rune:                                          +1 pt
6   Collect 3 or more runes in a game:                       +1 pt
7   Win a game                                               +1 pt
8   Complete a Tier I bonus:                                 +1 pt
9   Complete a Tier II bonus*:                               +2 pts
  * can have 6 or 7 and 8 or 9 only */

filters = {'##crawl-sprigganrockhaulersinc':[]};

// dictionary of nick-aliases:
nick_aliases = {"Kramin":"Kramin|hyperkramin"};

var cheiquerychan = control_channel;
var sequellquerychan = control_channel;

function check_csdc_points(bot, name, message, csdcwk) {
    var save = false;
    if (!(name in csdcdata[csdcwk]['playerdata'])){
        csdcdata[csdcwk]['playerdata'][name]=[0,0,0,0,0,0,0,0,0];
        //console.log('added '+name+' to '+csdcwk);
        save = true;
    }
    //1   Kill a unique:
    if (message.search(/\) killed/)>-1 && !(message.search(/the ghost/)>-1) && !(message.search(/with \d+ points after \d+ turns/)>-1)){
        if (csdcdata[csdcwk]['playerdata'][name][0]==0){
            csdcdata[csdcwk]['playerdata'][name][0]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has killed a unique for 1 point!'));
            save = true;
        }
    }
    
    //2   Enter a multi-level branch of the Dungeon:
    if (message.search(/entered the Depths|\((Lair|Orc):/)>-1){
        if (csdcdata[csdcwk]['playerdata'][name][1]==0){
            csdcdata[csdcwk]['playerdata'][name][1]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has entered a branch for 1 point!'));
            save = true;
        }
    }
    
    //3   Reach the end of any multi-level branch (includes D):
    if (message.search(/reached level/)>-1){
        if (csdcdata[csdcwk]['playerdata'][name][2]==0){
            csdcdata[csdcwk]['playerdata'][name][2]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has finished a branch for 1 point!'));
            save = true;
        }
    }
    
    //4   Champion a listed god (from weekly list):
    if (message.search("Champion of "+csdcdata[csdcwk]['wkgods'])>-1){
        if (csdcdata[csdcwk]['playerdata'][name][3]==0){
            csdcdata[csdcwk]['playerdata'][name][3]=1;
            bot.say('##csdc', irc.colors.wrap('dark_green', name+' has championed a weekly god for 1 point!'));
            save=true;
        }
    }
    
    //5   Collect a rune:
    //6   Collect 3 or more runes in a game:
    if (message.search(/rune of Zot/)>-1){
        if (csdcdata[csdcwk]['playerdata'][name][4]==0){
            bot.say('##csdc', irc.colors.wrap('dark_red', name+' has found a rune for 1 point!'));
        }
        csdcdata[csdcwk][name][4]+=1;
        if (csdcdata[csdcwk]['playerdata'][name][4]>=3 && csdcdata[csdcwk]['playerdata'][name][5]==0){
            csdcdata[csdcwk]['playerdata'][name][5]=1;
            bot.say('##csdc', irc.colors.wrap('dark_red', name+' has found 3 runes for 1 point!'));
        }
        save = true;
    }
    
    //7   Win a game
    if (message.search(/escaped with the Orb/)>-1){
        if (csdcdata[csdcwk]['playerdata'][name][6]==0){
            csdcdata[csdcwk]['playerdata'][name][6]=1;
            bot.say('##csdc', irc.colors.wrap('light_red', name+' has won a game for 1 point!'));
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

function save_state() {
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/announcers', JSON.stringify(announcers), function (err) {
        if (err) throw err;
    });
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/channels', JSON.stringify(channels), function (err) {
        if (err) throw err;
    });
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/names', JSON.stringify(names), function (err) {
        if (err) throw err;
    });
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/filters', JSON.stringify(filters), function (err) {
        if (err) throw err;
    });
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/nick_aliases', JSON.stringify(nick_aliases), function (err) {
        if (err) throw err;
    });
    fs.writeFile(process.env.OPENSHIFT_DATA_DIR+'/csdcdata', JSON.stringify(csdcdata), function (err) {
        if (err) throw err;
    });
}

function load_state(callback) {
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/announcers', function (err, data) {
        if (err) throw err;
        announcers = JSON.parse(data);
    });
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/channels', function (err, data) {
        if (err) throw err;
        channels = JSON.parse(data);
        callback();
    });
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/names', function (err, data) {
        if (err) throw err;
        names = JSON.parse(data);
    });
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/filters', function (err, data) {
        if (err) throw err;
        filters = JSON.parse(data);
    });
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/nick_aliases', function (err, data) {
        if (err) throw err;
        nick_aliases = JSON.parse(data);
    });
    fs.readFile(process.env.OPENSHIFT_DATA_DIR+'/csdcdata', function (err, data) {
        if (err) throw err;
        csdcdata = JSON.parse(data);
    });
}

var bot;

function init() {
    bot = new irc.Client('chat.freenode.net', botnick, {
        channels: [control_channel,observe_channel].concat(channels),
        port: 8001,
        debug: true
    });

    bot.addListener('message', function(nick, chan, message) {
        if(  message.indexOf('Hello '+botnick) > -1
        ) {
            bot.say(chan, 'Hello!');
        }
    
        // get announcements
        if (chan == observe_channel){
            if (announcers.indexOf(nick)>-1){
                //console.log("found announcement");
                channels.forEach(function(ch) {
                    //console.log(ch)
                    names[ch].forEach(function(name) {
                        name = nick_aliases[name] ? nick_aliases[name] : name;
                        //console.log(name);
                        if (message.search(new RegExp("^("+name+") ", "i"))>-1){
                            name = message.match(new RegExp("^("+name+") ", "i"))[1];
                            //console.log(message+" contains "+name);
                            //console.log('name match: '+message.match(new RegExp("^("+name+") ", "i")));
                            
                            if (ch=='##csdc' && csdcrunning) {
                                for (var csdcwk in csdcdata) {
                                    if (csdcdata.hasOwnProperty(csdcwk)){
                                        console.log("checking for char "+csdcdata[csdcwk]["wkchar"]);
                                        console.log("char match: "+message.match(new RegExp("\(L\d+ "+csdcdata[csdcwk]["wkchar"]+"\)")));
                                        if (csdcdata[csdcwk]["active"] && message.search("\(L\d+ "+csdcdata[csdcwk]["wkchar"]+"\)")>-1){
                                            console.log("checking points for "+name);
                                            check_csdc_points(bot, name, message, csdcwk);
                                        }
                                    }
                                }
                            }
                            
                            var matched = true;
                            filters[ch].forEach(function(match) {
                                if (message.search(match)==-1){
                                    matched = false;
                                }
                            });
                            if (matched){
                                bot.say(ch, irc.colors.wrap('gray', message));
                                //console.log(ch+" :"+message);
                            }
                        }
                    });
                });
            }
        }
    
        // redirect sequell/chei queries
        if (channels.indexOf(chan)>-1){
            if (message[0] == '%'){
                bot.say(chei, message);
                cheiquerychan = chan;
            }
            if ('!=&.?@^'.indexOf(message[0])>-1){
                bot.say(sequell, message.replace(/ \. /g, ' @'+nick+' ').replace(/ \.$/, ' @'+nick));
                sequellquerychan = chan;
            }
        }
    
        // post sequell answers
        if (chan == botnick && nick == sequell){
            msgarray = message.split(':');
            if (msgarray.length>2 && msgarray[0]=="nick-alias"){
                var NAnick = msgarray[1];
                nick_aliases[NAnick] = msgarray[2].replace(/ NAJNR/g,'|').replace('\r\n','');
                for (i=4; i<msgarray.length; i+=2){
                    nick_aliases[NAnick] = nick_aliases[NAnick]+'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
                }
                bot.say(control_channel, "nick mapping: "+NAnick+" => "+nick_aliases[NAnick])
            } else if (message.search(/^NAJNR/)>-1){
                for (i=0; i<msgarray.length; i+=2){
                    nick_aliases[NAnick] = nick_aliases[NAnick]+'|'+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n','');
                    bot.say(control_channel, "...|"+msgarray[i].replace(/ NAJNR/g,'|').replace(/NAJNR/g,'').replace('\r\n',''));
                }
            } else {
                bot.say(sequellquerychan, message);
            }
        }
    
        //post chei answers
        if (chan == botnick && nick == chei){
            bot.say(cheiquerychan, message);
        }
    
        // commands
        if (chan == control_channel && message[0]=='!'){
            var arg = message.split(' ');
            if (arg[0]=="!state"){
                bot.say(control_channel, "announcers: "+announcers);
                bot.say(control_channel, "channels: "+channels);
                bot.say(control_channel, "names: "+JSON.stringify(names));
                bot.say(control_channel, "filters: "+JSON.stringify(filters));
            }
        
            if (arg[0]=="!help" || arg[0]=="!commands"){
                bot.say(control_channel, "commands:");
                bot.say(control_channel, "  !state");
                bot.say(control_channel, "  !announcer [-rm] <announcer name>");
                bot.say(control_channel, "  !channel [-rm] <channel name>");
                bot.say(control_channel, "  !name [-rm] <channel name> <user name>");
                bot.say(control_channel, "  !filter [-rm] <channel name> <regex filter>");
            }
        
            if (arg[0]=="!announcer"){
                if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                    if (arg[1]=="-rm"){
                        if (announcers.indexOf(arg[2])>-1){
                            announcers.pop(arg[2]);
                            bot.say(control_channel, "announcers: "+announcers.join(', '));
                        } else {
                            bot.say(control_channel, "No such announcer");
                        }
                    } else {
                        if (announcers.indexOf(arg[1])==-1){
                            announcers.push(arg[1]);
                        }
                        bot.say(control_channel, "announcers: "+announcers.join(', '));
                    }
                } else {
                    bot.say(control_channel, "Usage: !announcer [-rm] <announcer name>");
                }
            }
        
            if (arg[0]=="!channel"){
                if (arg.length>2 || (arg.length==2 && arg[1]!="-rm")){
                    if (arg[1]=="-rm"){
                        if (channels.indexOf(arg[2])>-1){
                            channels.pop(arg[2]);
                            delete names[arg[2]];
                            delete filters[arg[2]];
                            bot.part(arg[2],'',null)
                            bot.say(control_channel, "channels: "+channels.join(', '));
                        } else {
                            bot.say(control_channel, "No such channel");
                        }
                    } else if (forbidden.indexOf(arg[1])==-1) {
                        if (channels.indexOf(arg[1])>-1){
                            bot.say(control_channel, "Names in "+arg[1]+": "+names[arg[1]].join(', '));
                        } else {
                            channels.push(arg[1]);
                            names[arg[1]]=[];
                            filters[arg[1]]=[];
                            bot.join(arg[1],null);
                            bot.say(control_channel, "channels: "+channels.join(', '));
                        }
                    } else {
                        bot.say(control_channel, "Sorry, I don't allow that channel");
                    }
                } else {
                    bot.say(control_channel, "Usage: !channel [-rm] <channel name>");
                }
            }
        
            if (arg[0]=="!name"){
                if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
                    if (arg[1]=="-rm"){
                        if (channels.indexOf(arg[2])>-1){
                            if (names[arg[2]].indexOf(arg[3])>-1){
                                names[arg[2]].pop(arg[3]);
                                bot.say(control_channel, arg[2]+": "+names[arg[2]].join(", "));
                            } else {
                                bot.say(control_channel, "No such name");
                            }
                        } else {
                            bot.say(control_channel, "No such channel");
                        }
                    } else {
                        if (channels.indexOf(arg[1])>-1){
                            if (names[arg[1]].indexOf(arg[2])==-1){
                                names[arg[1]].push(arg[2]);
                            }
                            update_aliases(arg[2]);
                            bot.say(control_channel, arg[1]+": "+names[arg[1]].join(", "));
                        } else {
                            bot.say(control_channel, "No such channel");
                        }
                    }
                } else {
                    bot.say(control_channel, "Usage: !name [-rm] <channel name> <user name>");
                }
            }
        
            if (arg[0]=="!filter"){
                if (arg.length>3 || (arg.length==3 && arg[1]!="-rm")){
                    if (arg[1]=="-rm"){
                        if (channels.indexOf(arg[2])>-1){
                            arg[3] = arg.slice(3, arg.length).join(' ');
                            if (filters[arg[2]].indexOf(arg[3])>-1){
                                filters[arg[2]].pop(arg[3]);
                                bot.say(control_channel, arg[2]+" filters: "+filters[arg[2]].join(", "));
                            } else {
                                bot.say(control_channel, "No such filter");
                            }
                        } else {
                            bot.say(control_channel, "No such channel");
                        }
                    } else {
                        if (channels.indexOf(arg[1])>-1){
                            arg[2] = arg.slice(2, arg.length).join(' ');
                            if (filters[arg[1]].indexOf(arg[2])==-1){
                                filters[arg[1]].push(arg[2]);
                            }
                            bot.say(control_channel, arg[1]+" filters: "+filters[arg[1]].join(" , "));
                        } else {
                            bot.say(control_channel, "No such channel");
                        }
                    }
                } else {
                    bot.say(control_channel, "Usage: !filter [-rm] <channel name> <regex filter>");
                }
            }
        
            if (arg[0]=="!savestate"){
                save_state();
            }
            if (arg[0]=="!loadstate"){
                load_state(nop);
            }
            if (arg[0]=="!csdc"){
                csdcrunning = !csdcrunning;
                if (csdcrunning){
                    bot.say(control_channel, 'csdc on');
                } else {
                    bot.say(control_channel, 'csdc off');
                }
            }
            if (arg[0]=="!csdcwkon") {
                
            }
            save_state();
        }
    
    });
}

load_state(init);

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

