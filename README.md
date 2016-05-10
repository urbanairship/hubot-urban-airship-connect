# hubot-urban-airship-connect

A hubot script for seeing Urban Airship Connect events

See [`src/hubot-urban-airship-connect.js`](src/hubot-urban-airship-connect.js) for full documentation.

## Installation

In hubot project repo, run:

`npm install hubot-urban-airship-connect --save`

Then add **hubot-urban-airship-connect** to your `external-scripts.json`:

```json
[
  "hubot-urban-airship-connect"
]
```

## Sample Interaction

```
user1>> !current
hubot>> ⛵ {"filters":[{"device_types":["ios","android","amazon"],"types":["PUSH_BODY","CUSTOM","TAG_CHANGE","FIRST_OPEN","UNINSTALL","RICH_DELIVERY","RICH_READ","RICH_DELETE","IN_APP_MESSAGE_EXPIRATION","IN_APP_MESSAGE_RESOLUTION","IN_APP_MESSAGE_DISPLAY","SEND"]}],"start":"LATEST"}
hubot>> 👀 device.named_user_id, device.ios_channel, device.android_channel, device.amazon_channel, type, body.name, body.value, body.group_id
```
