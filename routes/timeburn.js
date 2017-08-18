var config = require('config');
const tokenizer = require('string-tokenizer')

var genUUID = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

Slack = require('node-slackr');

var postDynamoDB = function (data) {
  var awsCredentials = config.get('timeburn.aws.credentials');
  var ddb = {
    tableName: config.get('timeburn.aws.dynamo.tablename')
  };
  var DynamoDB = require('aws-dynamodb')(awsCredentials);

  DynamoDB
    .table(ddb.tableName)
    .insert({
      ID: data.ID,
      UserName: data.userName,
      Thing: data.text,
      Duration: data.duration,
      CreatedDateTime: data.isodate
    }, function (err, data) {
      console.log(err, data)
    });
};

var postGDoc = function (data) {

  var Spreadsheet = require('edit-google-spreadsheet');

  Spreadsheet.load({
    debug: true,
    spreadsheetId: config.get('timeburn.google.spreadsheetId'),
    worksheetId: config.get('timeburn.google.worksheetId'),

    "oauth2": config.get('timeburn.google.oauth2')

  }, function sheetReady(err, spreadsheet) {
    if (err) throw err;

    spreadsheet.receive(function (err, rows, info) {
      if (err) throw err;
      var rowNum = info.lastRow + 1;
      console.log('Next Row Num is: ' + rowNum);

      var obj = {};
      obj[rowNum] = [[data.userName, data.text, data.duration, data.gdocDate, data.ID]];
      console.log(obj);
      spreadsheet.add(obj);
      spreadsheet.send(function (err) {
        if (err) throw err;
      });
    });
  });
};

const commandParser = function (commandText) {
  const tokens = tokenizer()
    .input(commandText)
    .token('duration', /[1-9][0-9]*/)
    .resolve();

  return {
    thing: commandText.substr(0, commandText.length-tokens.duration.length),
    duration: tokens.duration
  }
}


module.exports = function (router) {
  router.post('/timeburn', function (req, res) {

    var slackWebhookUrl = config.get('timeburn.slack.url');
    var slackToken = config.get('timeburn.slack.token');
    var originChannelName = req.body.channel_name;
    //console.log("REQUEST: \n" + JSON.stringify(req.body));
    //console.log("Origin Channel: " + originChannelName);

    var format = require('date-format');
    var timestamp = new Date();

    const { thing, duration } = commandParser(req.body.text);

    var data = {
      token: req.body.token,
      ID: genUUID(),
      userName: req.body.user_name,
      cmd: req.body.command,
      text: thing,
      duration: duration,
      isodate: timestamp.toISOString(),
      gdocDate: format.asString('MM/dd/yyyy hh:mm:ss', timestamp)
    };

    //console.log("TOKEN: " + token);
    //console.log("USER: " + userName);
    //console.log("CMD: " + cmd);
    //console.log("TEXT: " + text);

    // Check that the slack token is valid.
    if (data.token != slackToken) {
      res.sendStatus(403);
      res.end();
    }

    // Check for empty string passed in.
    if (!data.text || data.text.trim().length === 0) {
      res.send('Your timeburn thing appears to be empty. Be timeburn and try again.');
      res.end();
    } else {

      // get the channel where the command was called from.
      var postOriginChannel = '';
      if (originChannelName != 'privategroup') {
        postOriginChannel = ['#', originChannelName].join('');
      }

      // Get the target channel name
      var channels = config.get('timeburn.slack.post_channel');
      // If the name of the target channel is different than the origin, post to both channels.
      if (postOriginChannel != channels) {
        channels = [config.get('timeburn.slack.post_channel'), postOriginChannel];
      }

      slack = new Slack(slackWebhookUrl, {
        username: config.get('timeburn.slack.post_username'),
        channel: channels,
        icon_emoji: config.get('timeburn.slack.post_emoji')
      });

      var message = {
        text: "*TimeBurn | " + data.userName + "*\n" + data.text
      };

      if (data.cmd === '/timeburn') {

        if (timeburn.config.aws.enabled) {
          postDynamoDB(data);
        }
        if (timeburn.config.google.enabled) {
          postGDoc(data);
        }

        slack.notify(message);
        res.send('Sucessfully recorded that you spent ${data.duration} minutes on ${data.text}.');
      } else {
        res.end();
      }
    }
  });
};




