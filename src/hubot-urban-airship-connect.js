// Description:
//   Urban Airship Connect bot
//
// Commands:
//   !current - see the current stream and output configuration
//   !show <DOTPATH> - add a new property to pull out on display
//   !hide <DOTPATH> - remove a property from display
//   !set output <DOTPATH>, <DOTPATH>, ... - set the output properties directly
//   !reset - reset stream and output configuration
//   !set current <JSON> - set the stream configuration directly
//   !set start (LATEST|EARLIEST) - the stream should start at the end or beginning of the app's data window
//   !set resume_offset <OFFSET> - The offset at which to start streaming.
//   !set subset sample <PROPORTION> - Proportion is a value from 0.0-1.0 that specifies which fraction of events written to the response, chosen randomly.
//   !set subset partition <COUNT> <SELECTION> - Count is how many partitions to split the stream into, selection is which one should appear.
//   !clear subset - Remove any subset portions of the stream configuration
//   !filters add device_types (ios|android|amazon)
//   !filters remove device_types (ios|android|amazon)
//   !filters add types (PUSH_BODY|OPEN|CLOSE|CUSTOM|LOCATION|SEND|TAG_CHANGE|FIRST_OPEN|UNINSTALL|RICH_DELIVERY|RICH_READ|RICH_DELETE|IN_APP_MESSAGE_EXPIRATION|IN_APP_MESSAGE_DISPLAY)
//   !filters remove types (PUSH_BODY|OPEN|CLOSE|CUSTOM|LOCATION|SEND|TAG_CHANGE|FIRST_OPEN|UNINSTALL|RICH_DELIVERY|RICH_READ|RICH_DELETE|IN_APP_MESSAGE_EXPIRATION|IN_APP_MESSAGE_DISPLAY)
//   !filters clear (device_types|notifications|devices|types|latency)
'use strict'

const connect = require('urban-airship-connect')
const debounce = require('debounce-stream')
const lookup = require('dotpather')
const objectstate = require('objectstate')

const MESSAGE_PER_MS = 1000
const BRAIN_NAMESPACE = 'uaconnect'
const BRAIN_STATE_KEY = `${BRAIN_NAMESPACE}:lastState`
const BRAIN_OUTPUT_KEY = `${BRAIN_NAMESPACE}:lastOutput`
const UA_APP_KEY = process.env.UA_CONNECT_APPKEY
const CONNECT_TOKEN = process.env.UA_CONNECT_TOKEN
const ROOMS = process.env.UA_CONNECT_ROOMS.split(',')

const FILTER_KEYS = new Set([
  'device_types', 'notifications', 'devices', 'types', 'latency'
])
const EVENT_TYPES = new Set([
  'PUSH_BODY',
  'CUSTOM',
  'TAG_CHANGE',
  'FIRST_OPEN',
  'UNINSTALL',
  'RICH_DELIVERY',
  'RICH_READ',
  'RICH_DELETE',
  'IN_APP_MESSAGE_EXPIRATION',
  'IN_APP_MESSAGE_RESOLUTION',
  'IN_APP_MESSAGE_DISPLAY',
  'SEND'
])
const DEVICE_TYPES = new Set(['ios', 'android', 'amazon'])
const DEFAULT_OUTPUT = new Set([
  'device.named_user_id',
  'device.ios_channel',
  'device.android_channel',
  'device.amazon_channel',
  'type',
  'body'
])
const FILTERS = new Map([
  ['device_types', {allowed: DEVICE_TYPES}],
  ['types', {allowed: EVENT_TYPES}]
])

const DEFAULT_STATE = {
  filters: [{
    device_types: Array.from(DEVICE_TYPES),
    types: Array.from(EVENT_TYPES)
  }],
  start: 'LATEST'
}

module.exports = robot => {
  robot.brain.once('loaded', setup)

  function setup () {
    const initialState = robot.brain.get(BRAIN_STATE_KEY) || DEFAULT_STATE
    const state = objectstate(initialState)
    const stream = connect(UA_APP_KEY, CONNECT_TOKEN)

    let output = new Set(robot.brain.get(BRAIN_OUTPUT_KEY) || DEFAULT_OUTPUT)

    saveState(initialState)
    state.on('data', saveState)

    robot.hear(/^!reset/i, res => {
      output = new Set(DEFAULT_OUTPUT)
      state.write(DEFAULT_STATE)
    })

    robot.hear(/^!set output (.*)/i, res => {
      output = new Set(res.match[1].split(',').map(s => s.trim()))
      saveOutput(output)
      res.send('👍 output settings updated')
    })

    robot.hear(/^!show (.*)/i, res => {
      const dotpath = res.match[1]

      if (output.has(dotpath)) {
        res.send(`😞 already showing ${dotpath}`)
        return
      }

      output.add(dotpath)
      saveOutput(output)
      res.send('👍 output settings updated')
    })

    robot.hear(/^!hide (.*)/i, res => {
      const dotpath = res.match[1]

      if (!output.has(dotpath)) {
        res.send(`😞 not showing ${dotpath}`)
        return
      }

      output.delete(dotpath)
      saveOutput(output)
      res.send('👍 output settings updated')
    })

    robot.hear(/^!set current (.*)$/i, res => {
      let data

      try {
        data = JSON.parse(res.match[1])
      } catch (err) {
        res.send(`😞 error parsing JSON: ${err.message}`)
        return
      }

      state.write(data)
    })

    robot.hear(/^!current/i, res => {
      res.send(`⛵ ${JSON.stringify(state.state())}`)
      res.send(`👀 ${Array.from(output).join(', ')}`)
    })

    robot.hear(/^!set start (\w+)/i, res => {
      state.wait(() => {
        state.remove('resume_offset')
        state.set('start', res.match[1])
      })
    })

    robot.hear(/^!set resume_offset (\d+)/i, res => {
      state.wait(() => {
        state.remove('start')
        state.set('resume_offset', res.match[1])
      })
    })

    robot.hear(/^!set subset sample (\d*(\.\d+)?)/i, res => {
      const proportion = Number(res.match[1])

      if (proportion < 0 || proportion > 1) {
        res.send(`😞 invalid proportion value: ${proportion}`)
        return
      }

      state.set('subset', {type: 'SAMPLE', proportion})
    })

    robot.hear(/^!set subset partition (\d+) (\d+)/i, res => {
      const count = parseInt(res.match[1], 10)
      const selection = parseInt(res.match[2], 10)

      if (count < 1) {
        res.send('😞 count cannot be less than 1')
        return
      }

      if (selection > count) {
        res.send('😞 selection cannot be larger than count')
        return
      }

      state.set('subset', {type: 'PARTITION', count, selection})
    })

    robot.hear(/^!clear subset/i, res => {
      state.remove('subset')
    })

    robot.hear(/^!filters clear (\w+)/i, res => {
      const filterType = res.match[1]

      if (FILTER_KEYS.has(filterType)) {
        res.send(`😞 invalid filter type ${filterType}`)
        return
      }

      const removed = state.remove(`filters.0.${filterType}`)

      if (!removed) {
        const available = Object.keys(state.get('filters.0'))
          .filter(key => FILTER_KEYS.has(key))
          .join(', ')

        res.send(
          `😞 no filters defined for ${filterType}. available filters: ${available}`
        )
      }
    })

    robot.hear(/^!filters (add|remove) (\w+) (\w+)/i, res => {
      const operation = res.match[1]
      const filterType = res.match[2]
      const filter = res.match[3]

      if (!FILTERS.has(filterType)) {
        res.send(`😞 invalid filter type ${filterType}`)
        return
      }

      const allowed = FILTERS.get(filterType).allowed

      if (!allowed.has(filter)) {
        res.send(`😞 invalid ${filterType}: ${filter}`)
        return
      }

      const filterKeypath = `filters.0.${filterType}`
      const currentFilters = state.get(filterKeypath) || []

      if (operation === 'add') {
        if (currentFilters.indexOf(filter) !== -1) {
          res.send(`😞 ${filterType} filter already includes ${filter}`)
          return
        }

        state.set(filterKeypath, currentFilters.concat(filter))
      } else if (operation === 'remove') {
        if (currentFilters.indexOf(filter) === -1) {
          res.send(`😞 ${filterType} filter does not include ${filter}`)
          return
        }

        state.set(filterKeypath, currentFilters.filter(f => f !== filter))
      }
    })

    stream
       //.pipe(debounce(MESSAGE_PER_MS, true))
      .on('data', postToChannel)
    stream
      .on('error', postError)

    state.pipe(stream)
    state.emitState()

    state.on('data', () => sendToAll('👍 stream settings updated'))

    function saveState (data) {
      robot.brain.set(BRAIN_STATE_KEY, data)
    }

    function saveOutput (data) {
      robot.brain.set(BRAIN_OUTPUT_KEY, Array.from(data))
    }

    function postError (err) {
      sendToAll(err.message)
    }

    function postToChannel (data) {
      const message = Array.from(output)
        .filter(id => lookup(id)(data) !== void 0)
        .map(id => {
          let value = lookup(id)(data)

          if (typeof value === 'object') {
            value = JSON.stringify(value)
          }

          return `${id}: ${value}`
        })
        .join(', ')

      sendToAll(message)
    }

    function sendToAll (message) {
      ROOMS.forEach(room => robot.messageRoom(room, message))
    }
  }
}
