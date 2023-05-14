const express = require("express")
const bodyParser = require("body-parser")
const cors = require('cors')
const { MongoClient } = require("mongodb")
const io = require("socket.io-client")
const config = require("./config.json");
const axios = require("axios");
const Discord = require("discord.js");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');

const StringManager = config.dbString;
const client = new MongoClient(StringManager, { useUnifiedTopology: true, maxPoolSize: 50000 });

const rest = new REST({ version: '9' }).setToken(config.BOT_TOKEN);

const app = express()
app.use(bodyParser.json( { limit: '20mb'} ))
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }))
app.use(cors());

var SocketPack = [];
/*
    {
        Active: false
        id: YT_xxxxx
        lang: xx
    }
*/
var BotPack = {};
/*
    key: addr
    value: channel
*/
var BroadcastPack = {};
/*
    key: Channel ID
    value [{
        addr
        lang
    }]
*/
var BroadcastTemporaryPack = {};
/*
    key: Video ID
    value [{
        addr
        lang
    }]
*/
var VideoIDPack = {};
/*
    key: video_id
    value: channel_id
*/

var LastBounce = {};
/*
    key: video_id
    value: lastText
*/

function SeekRoom(pack){
    for (let i = 0; i < SocketPack.length; i++) {
        if ((SocketPack[i].id == pack.id) && (SocketPack[i].lang == pack.lang)) {
            return (i);
        }
    }
    return (-1);
}

//-------------------------------------------------------- SOCKET HANDLER --------------------------------------------------------

let HoloSocket;

function InitSocket() {
    HoloSocket = io('wss://holodex.net', {
        path: '/api/socket.io/',
        transports: ['websocket'],
    });
      
     HoloSocket.on('connect_error', async (err) => {
        console.log("Socket Err: " + err);
        setTimeout(() => {
            HoloSocket = io('wss://holodex.net', {
                path: '/api/socket.io/',
                transports: ['websocket'],
            });
        }, 3000);
    });
    
    HoloSocket.on('connect', () => {
        SocketPack.forEach(e => {
            HoloSocket.emit('subscribe', { video_id: e.id.slice(3), lang: e.lang });
        });
    });
      
    HoloSocket.onAny((trigger, ...args) => {
        switch (trigger) {
            case 'subscribeSuccess': {
                args.forEach(e => {
                    SubsSuccess(e);
                })                
                break;
            }

            case 'subscribeError': {
                args.forEach(e => {
                    SubsError(e);
                })                
                break;
            }

            case 'unsubscribeSuccess': {
                args.forEach(e => {
                    UnsubSuccess(e);
                });
                break;
            }
        
            default:{
                const dt = trigger.split('/');
                if (dt.length == 2) {
                    args.forEach (e => {
                        NewTl(e, {id: "YT_" + dt[0], lang: dt[1]});
                    })                    
                    break;
                } else {
                    console.log(trigger + ': ' + JSON.stringify(args));
                    break;
                }
            }
        }
    })
}

function SubsSuccess(dt) {
    SocketPack.filter(e => e.id === "YT_" + dt.id).forEach(e => {
        e.Active = true;
    });        
}

function UnsubSuccess(dt) {
    SocketPack = SocketPack.filter(e => e.id !== "YT_" + dt.id);
    delete VideoIDPack["YT_" + dt.id];
    delete BroadcastTemporaryPack["YT_" + dt.id];
}

function SubsError(dt) {
    SocketPack.filter(e => e.id === "YT_" + dt.id).forEach(e => {
        e.Active = false;
    });
    setTimeout(() => {
        SocketPack.filter(e => (e.id === "YT_" + dt.id) && (!e.Active)).forEach(e => {
            HoloSocket.emit('subscribe', { video_id: e.id.slice(3), lang: e.lang });
        });
    }, 2000);
}

function NewTl(dt, IdPack) {
    /*
    const cmt: ChatComment = {
        id: msg.channel_id ?? 'MChad-' + msg.name,
        name: msg.name,
        body: msg.message.replace(/:http\S+( |$)/g, ':'),
        time: msg.timestamp,
        msg.channel_id
        isMod: msg.is_moderator,
        isOwner: msg.channel_id === frame.channel.id,
        isTl: msg.is_tl || msg.source === 'MChad',
        isV: msg.is_vtuber,
      }
    */

    if (!dt.name) {
        return;
    }

    if (!dt.is_tl) {
        return;
    }

    if (LastBounce[IdPack.id] != dt.message) {
        BounceBot({
            id: VideoIDPack[IdPack.id],
            lang: IdPack.lang
        }, {
            name: dt.name,
            msg: dt.message.replace(/:http\S+( |$)/g, ':')
        })
        BounceBotTemporary({
            id: IdPack.id,
            lang: IdPack.lang
        }, {
            name: dt.name,
            msg: dt.message.replace(/:http\S+( |$)/g, ':')
        })
    }
    LastBounce[IdPack.id] = dt.message;
}

function RerunSocket() {
    SocketPack.forEach(e => {
        if (!e.Active) {
            HoloSocket.emit('subscribe', { video_id: e.id.slice(3), lang: e.lang });
        }
    });
}
//======================================================== SOCKET HANDLER ========================================================



//-------------------------------------------------------- BOT HANDLER --------------------------------------------------------
const myIntents = new Discord.Intents();
myIntents.add(Discord.Intents.FLAGS.GUILD_MESSAGES, new Discord.Intents(513));
const DSclient = new Discord.Client({ intents: myIntents });

const langCode = [
    {name: 'English', value: 'en'},
    {name: 'Indonesian', value: 'id'},
    {name: 'Korean', value: 'ko'},
    {name: 'Chinese', value: 'zh'},
    {name: 'Japanese', value: 'ja'},
    {name: 'Spanish', value: 'es'},
    {name: 'Russian', value: 'ru'},
];

const commands = [
	    new SlashCommandBuilder().setName('help').setDescription('How to use the bot'),
        new SlashCommandBuilder().setName('listen').setDescription('Trigger relay manually')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('video')
                    .setDescription('Trigger relay manually based on video ID')
                    .addStringOption(option =>
                        option.setName('video_id')
                            .setDescription('YT video id, don\'t forget the YT_ prefix for youtube -> YT_xxxxxxx')
                            .setRequired(true)
                    ).addStringOption(option =>
                        option.setName('lang')
                            .setDescription('language code, default -> en')
                            .setRequired(false)
                            .addChoices(langCode[0])
                            .addChoices(langCode[1])
                            .addChoices(langCode[2])
                            .addChoices(langCode[3])
                            .addChoices(langCode[4])
                            .addChoices(langCode[5])
                            .addChoices(langCode[6])
                    )                    
            ).addSubcommand(subcommand =>
                subcommand
                    .setName('channel')
                    .setDescription('Trigger relay manually based on channel ID')
                    .addStringOption(option => 
                        option.setName('channel_id')
                            .setDescription('YT channel id, don\'t forget the YT_ prefix for youtube -> YT_xxxxxxx')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('lang')
                            .setDescription('language code, default -> en')
                            .setRequired(false)
                            .addChoices(langCode[0])
                            .addChoices(langCode[1])
                            .addChoices(langCode[2])
                            .addChoices(langCode[3])
                            .addChoices(langCode[4])
                            .addChoices(langCode[5])
                            .addChoices(langCode[6])
                    )
            ),
    ].map(command => command.toJSON());

async function InitBot() {
    await DSclient.login(config.BOT_TOKEN);
    delete BotPack;
    BotPack = {};
    (await client.db("DiscordBot").collection("data").find({}, {projection:{ _id: 0}}).toArray()).forEach(e => {
        DSclient.channels.fetch(e.Address).then(channel => {
            BotPack[e.Address] = channel;
            e.SubChannel.forEach(c => {
                const adPack = {
                    addr: e.Address,
                    lang: c.lang,
                    blacklist: c.blacklist ? c.blacklist : [],
                    whitelist: c.whitelist ? c.whitelist : []
                };

                if (!BroadcastPack[c.link]) {
                    BroadcastPack[c.link] = [];
                    BroadcastPack[c.link].push(adPack);
                } else if (BroadcastPack[c.link].filter(d => (d.addr == adPack.Address) && (d.lang == adPack.lang)).length == 0) {
                    BroadcastPack[c.link].push(adPack);
                }
            })
        }).catch(err => {
            if ((err == "DiscordAPIError: Unknown Channel") || (err == "DiscordAPIError: Missing Access")) {
                client.db("DiscordBot").collection("data").deleteOne({ Address: e.Address });
            }    
            console.log("ERR INIT BOT : " + err);
        });
    });
    await rest.put(
        Routes.applicationCommands(config.clientID),
        { body: commands },
    );
}

async function FirstRun() {
    Object.entries(BroadcastPack).forEach(([key, value]) => {
        switch (key.slice(0,3)) {
            case "YT_":
                axios.get('https://holodex.net/api/v2/videos?channel_id=' + key.slice(3) + '&status=live').then(data => {
                    if (data.status !== 200) {
                        return;
                    }
                    if (data.data.length === 0) {
                        return;
                    }
                    const link = "YT_" + data.data[0].id;

                    VideoIDPack[link] = key;
                    BroadcastPack[key].forEach(d => {
                        const indextarget = SeekRoom({
                            id: link,
                            lang: d.lang
                        });
                        
                        if (indextarget == -1) {
                            SocketPack.push({
                                Active: false,
                                id: link,
                                lang: d.lang
                            })
                            HoloSocket.emit('subscribe', { video_id: data.data[0].id, lang: d.lang });
                        } else {
                            if (!SocketPack[indextarget].Active) {
                                HoloSocket.emit('subscribe', { video_id: data.data[0].id, lang: d.lang });
                            }
                        }
                    });                                
                }).catch(err => {
                    console.log("ERR FIRST INIT " + key);
                }) 
                break;
        }
    });
}

function checkBWlist(blist, wlist, name) {
    if (wlist.length != 0) {
        if (wlist.includes(name)) {
            return true;
        } else {
            return false;
        }
    } else if (blist.length != 0) {
        if (wlist.includes(name)) {
            return false;
        } else {
            return true;
        }
    } else {
        return true;
    }
}

function BounceBot(IdPack, dt) {
    if (BroadcastPack[IdPack.id]) {
        BroadcastPack[IdPack.id].filter(e => e.lang == IdPack.lang).filter(e => checkBWlist(e.blacklist, e.whitelist, dt.name)) .forEach(e => {
            if (BotPack[e.addr]) {
                BotPack[e.addr].send(dt.name + ": **" + dt.msg + "**").then(e => {
                }).catch(err => {
                    console.log("1 " + err);
                });;
            }
        });
    }
}

function BounceBotTemporary(IdPack, dt) {
    if (BroadcastTemporaryPack[IdPack.id]) {
        BroadcastTemporaryPack[IdPack.id].filter(e => e.lang == IdPack.lang).forEach(e => {
            if (BotPack[e.addr]) {
                BotPack[e.addr].send(dt.name + ": **" + dt.msg + "**").then(e => {
                }).catch(err => {
                    console.log("2 " + err);
                });
            }
        });
    }
}

function ReloadSet(Address, SubChannel) {
    Object.entries(BroadcastPack).forEach(([key, value]) => {
        BroadcastPack[key] = BroadcastPack[key].filter(e => e.addr !== Address);
    });

    SubChannel.forEach(e => {
        const adPack = {
            addr: Address,
            lang: e.lang || "en",
            blacklist: e.blacklist || [],
            whitelist: e.whitelist || [],
        };
        if (!BroadcastPack[e.link]) {
            BroadcastPack[e.link] = [];
            BroadcastPack[e.link].push(adPack);
        } else if (BroadcastPack[e.link].filter(d => (d.addr == adPack.Address) && (d.lang == adPack.lang)).length == 0) {
            BroadcastPack[e.link].push(adPack);
        }
    });
}

DSclient.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;

	const { commandName, options } = interaction;

	if (commandName === 'help') {
		await interaction.reply('Go to ' + config.redirectUrlStaging + ' to setup bot.');
	} else if (commandName === 'listen') {
        if (options.getSubcommand() === 'channel') {
            ManualTrigger(interaction.channelId, 2, options.getString('channel_id'), options.getString('lang') ? options.getString('lang') : 'en', interaction);
        } else if (options.getSubcommand() === 'video') {
            ManualTrigger(interaction.channelId, 1, options.getString('video_id'), options.getString('lang') ? options.getString('lang') : 'en', interaction);
        }
    }
});

function ManualTrigger(address, mode, link, lang, interact) {
    if (mode === 0) {
        botReply(interact, undefined);
    }

    let channelLink = link;
    if (mode === 2) {
        axios.get('https://holodex.net/api/v2/videos?channel_id=' + link.slice(3) + '&status=live').then(data => {
            if (data.status === 200) {
                if (data.data.length !== 0) {
                    link = "YT_" + data.data[0].id;
                }
            }
        }).catch(err => {
            console.log("1err " + err);
        });
    } else if (mode === 1) {
        axios.get('https://holodex.net/api/v2/videos?id=' + link.slice(3)).then(data => {
            if (data.status === 200) {
                if (data.data.length !== 0) {
                    if (data.data[0].status === 'live') {
                        channelLink = "YT_" + data.data[0].channel.id;
                    }        
                }
            }
        }).catch(err => {
            console.log("2err " + err);
        });
    }

    DSclient.channels.fetch(address).then(async (channel) => {
        BotPack[address] = channel;

        if (channelLink === link) {
            if (BroadcastTemporaryPack[link]) {
                BroadcastTemporaryPack[link].push({
                    addr: address,
                    lang: lang
                });
            } else {
                BroadcastTemporaryPack[link] = [{
                    addr: address,
                    lang: lang
                }];
            }
        } else {
            VideoIDPack[link] = channelLink;
        
            if (BroadcastPack[channelLink]) {
                if (BroadcastPack[channelLink].filter(e => e.lang === lang && e.addr === address).length === 0) {
                    if (BroadcastTemporaryPack[link]) {
                        BroadcastTemporaryPack[link].push({
                            addr: address,
                            lang: lang
                        });
                    } else {
                        BroadcastTemporaryPack[link] = [{
                            addr: address,
                            lang: lang
                        }];
                    }
                }        
            } else {
                if (BroadcastTemporaryPack[link]) {
                    BroadcastTemporaryPack[link].push({
                        addr: address,
                        lang: lang
                    });
                } else {
                    BroadcastTemporaryPack[link] = [{
                        addr: address,
                        lang: lang
                    }];
                }
            }
        }

        const indextarget = SeekRoom({
            id: link,
            lang: lang
        });
        
        if (indextarget == -1) {
            SocketPack.push({
                Active: false,
                id: link,
                lang: lang
            })
            HoloSocket.emit('subscribe', { video_id: link.slice(3), lang: lang });
        } else {
            if (!SocketPack[indextarget].Active) {
                HoloSocket.emit('subscribe', { video_id: link.slice(3), lang: lang });
            }
        }

        botReply(interact, link);
    }).catch(err => {
        console.log("ERR INIT BOT : " + err);
    });
}

function botReply(interact, link) {
    if (interact) {
        switch (link.slice(0, 3)) {
            case "YT_":
                interact.reply('Started relying for stream <https://www.youtube.com/watch?v=' + link.slice(3) + '>');
                break;
        
            default:{
                if (link) {
                    interact.reply('Can\t find the stream to be relayed.');
                } else {
                    interact.reply('Nope, doesn\'t work.');
                }                
                break;
            }
        }
    }
}
//======================================================== BOT HANDLER ========================================================

function holowatch() {
    axios.get('https://holodex.net/api/v2/videos?limit=50&status=upcoming&max_upcoming_hours=0.5').then(res => {
        res.data.filter(e => e.topic_id !== "membersonly").filter(e => BroadcastPack["YT_" + e.channel.id] !== undefined).filter(e => Date.parse(e.available_at) < Date.now() + 1000*60*10).forEach(e => {
            VideoIDPack["YT_" + e.id] = "YT_" + e.channel.id;
            BroadcastPack["YT_" + e.channel.id].forEach(d => {
                const indextarget = SeekRoom({
                    id: "YT_" + e.id,
                    lang: d.lang
                });
                
                if (indextarget == -1) {
                    SocketPack.push({
                        Active: false,
                        id: "YT_" + e.id,
                        lang: d.lang
                    })
                    HoloSocket.emit('subscribe', { video_id: e.id, lang: d.lang });
                } else {
                    if (!SocketPack[indextarget].Active) {
                        HoloSocket.emit('subscribe', { video_id: e.id, lang: d.lang });
                    }
                }
            });            
        });
    }).catch(err => {
        console.log("1p " + err);
    });
    
    axios.get('https://holodex.net/api/v2/videos?limit=25&status=live').then(res => {
        res.data.filter(e => e.topic_id !== "membersonly").filter(e => BroadcastPack["YT_" + e.channel.id] !== undefined).forEach(e => {
            VideoIDPack["YT_" + e.id] = "YT_" + e.channel.id;
            BroadcastPack["YT_" + e.channel.id].forEach(d => {
                const indextarget = SeekRoom({
                    id: "YT_" + e.id,
                    lang: d.lang
                });
                
                if (indextarget == -1) {
                    SocketPack.push({
                        Active: false,
                        id: "YT_" + e.id,
                        lang: d.lang
                    })
                    HoloSocket.emit('subscribe', { video_id: e.id, lang: d.lang });
                } else {
                    if (!SocketPack[indextarget].Active) {
                        HoloSocket.emit('subscribe', { video_id: e.id, lang: d.lang });
                    }
                }
            });            
        });
    }).catch(err => {
        console.log("2p " + err);
    });

    axios.get('https://holodex.net/api/v2/videos?limit=25&status=past').then(res => {
        res.data.filter(e => e.topic_id !== "membersonly").forEach(e => {
            SocketPack.filter(d => (d.id == "YT_" + e.id) && (d.Active)).forEach(d => {
                HoloSocket.emit('unsubscribe', { video_id: e.id, lang: d.lang });
            })
        })
    }).catch(err => {
        console.log("3p " + err);
    });
}

app.post('/guild', async function (req, resmain) {
    axios.get('https://discord.com/api/users/@me/guilds', {
        headers: {
            authorization: `Bot ${config.BOT_TOKEN}`,
        },
    }).then(res2 => {
        var test = res2.data.map(e => {return e.id}).filter(e => req.body.ids.includes(e));
        return resmain.status(200).json(test);
    }).catch(() => {
        return resmain.status(400).send("bot retrieve err")
    });
});
  
app.post('/channel', async function (req, resmain) {
    if (req.body.guild){
      axios.get('https://discord.com/api/guilds/' + req.body.guild + '/channels', {
        headers: {
            authorization: `Bot ${config.BOT_TOKEN}`,
        },
      }).then(res => {
            return resmain.status(200).send(res.data.filter(e => e.type == 0).map(e => {
                return ({
                    id: e.id,
                    name: e.name
                });
            }));
        }).catch(err => {
            return resmain.status(400).send("bad bad request");
        });
    } else {
        return resmain.status(400).send("bad bad request");
    }
});
  
app.post('/user', async function (req, resmain) {
    if (req.body.code) {
        const params = new URLSearchParams();
        params.append('client_id', config.clientID);
        params.append('client_secret', config.clientSecret);
        params.append('grant_type', 'authorization_code');
        params.append('code', req.body.code);

        switch (req.body.mode) {
            case 0:
                params.append('redirect_uri', config.redirectUrlLocal);
                break;

            case 1:
                params.append('redirect_uri', config.redirectUrlStaging);
                break;
            
            case 2:
                params.append('redirect_uri', config.redirectUrlDeploy);                
                break;

            default:
                return resmain.status(400).send("NEED MODE");
        }
        
        params.append('scope', 'identify');      
  
        axios.post("https://discord.com/api/oauth2/token", params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }).then(res => {
            axios.get('https://discord.com/api/users/@me/guilds', {
                headers: {
                authorization: `${res.data.token_type} ${res.data.access_token}`,
            },
            }).then(res2 => {
                return resmain.status(200).json({
                    access_token: res.data.access_token,
                    guilds: res2.data.map(e => {
                        return {
                            id: e.id,
                            name: e.name,
                            admin: ((e.permissions & 0x8) == 0x8) || ((e.permissions & 0x4) == 0x4) || ((e.permissions & 0x2) == 0x2)
                        }
                    })
                });
            }).catch(err => {
                return resmain.status(400).send("bad bad request1");
            });
        }).catch(err => {
            return resmain.status(400).send("bad bad request2");
        });
    } else {
      return resmain.status(400).send("bad bad request3");
    }
});
  
app.post('/submit', async function (req, res) {
    if (!req.body.Address) {
      return res.status(400).send("bad bad request");
    }
    
    var UpdateCmd = {
      $set: {}
    };
  
    if (req.body.SubChannel) {
      UpdateCmd.$set.SubChannel = req.body.SubChannel;
    }
  
    try {
      DSclient.channels.fetch(req.body.Address).then(channel => {
            BotPack[req.body.Address] = channel;
      });
      client.db("DiscordBot").collection("data").updateOne( { Address: req.body.Address }, UpdateCmd, { upsert: true });
      ReloadSet(req.body.Address, req.body.SubChannel);
      return res.status(200).send("OK");
    } catch (error) {
      return res.status(400).send("NOT OK");
    }
  });
  
  app.post('/data', async function (req, res) {
    if (req.body.channel){
      var query = await client.db("DiscordBot").collection("data").find( {Address: req.body.channel }).toArray(); 
      if (query.length == 0) {
        return res.status(200).json({});
      } else {
        return res.status(200).json(query[0]);
      }
    } else {
      return res.status(400).send("bad bad request");
    }
  });

  app.post('/trigger', async function(req, res) {
    if (!req.body.Address || !req.body.mode || !req.body.link) {
        return res.status(400).send("bad bad request");
    }

    if (!req.body.lang) {req.body.lang = 'en';}

    res.status(200).send("Ok!");
    ManualTrigger(req.body.Address, req.body.mode, req.body.link, req.body.lang, undefined);
  });

app.post('/Announce', async function (req, res) {
    if (!req.body.pass) {
        return res.status(400).send("NO!")
    }

    if (req.body.pass != "d055a5c1c4eb2589f69f99909913332957664b5aa7fb17bb71bbd8cc4034c020") {
        return res.status(400).send("NO!")
    }

    res.status(200).send("Aye aye!")
    var query = await client.db("DiscordBot").collection("Subscribers").find({}, {projection:{ _id: 0, Address: 1}}).toArray();
    query.forEach(e => {
        DSclient.channels.fetch(e.Address).then(channel => {
            try {
                channel.send({ embeds: [new Discord.MessageEmbed()
                    .setColor('#FF2F02')
                    .setTitle('ANNOUNCEMENT pt2 (Sorry, there was a typo)')
                    .setDescription("Just a small update for a few requested updates"
                        + "\n--------------------------------------------------------------------------")
                    .addField("CHANGES",
                        "- Added manual trigger, whitelist, and blacklist."
                        + "\n- Manual trigger can be used with slash command /listen video {YT_videoID} (ex: /listen video YT_hrpubiRwB-k)."
                        + "\n- Or slash command for channel to relay live steram of the channel /listen channel {YT_channelID} (ex: /listen channel YT_UCp6993wxpyDPHUpavwDFqgg)."
                        + "\n- Whitelist and blacklist setting can be found in the usual GUI at"
                        + "https://staging.holodex.net/relaybot"
                        + "\n--------------------------------------------------------------------------")
                    .addField("IMPORTANT",
                        "It seems that you will need to re-invite the bot to use slash command"
                        + "\nhttps://discord.com/api/oauth2/authorize?client_id=826055534318583858&permissions=274877910016&scope=bot%20applications.commands"
                        + "\n--------------------------------------------------------------------------")
                ]}).then(e => {
                }).catch(err => {
                    console.log("3 " + err);
                });;                
            } catch (err) {
                console.log(e.Address + " : " + err);
            }
        }).catch(err => {
            console.log(e,Address + " : " + err);
        });
    });
  });


async function InitServer() {
    await client.connect();
    await InitBot();
    await FirstRun();
    InitSocket();
    setInterval(holowatch, 1000*60);

    app.listen(config.port, async function () {
        console.log(`Server initialized on port ${config.port}`);
    })
}

InitServer();