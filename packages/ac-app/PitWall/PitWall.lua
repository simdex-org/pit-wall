local URL = 'http://127.0.0.1:9877/state'
local HEAD = { ['Content-Type'] = 'application/json', ['X-Pit-Source'] = 'ac' }
local EVERY = 0.25

local sim = ac.getSim()
local flags = {
  [ac.FlagType.Start] = 7, [ac.FlagType.Caution] = 2, [ac.FlagType.Stop] = 3, [ac.FlagType.ReturnToPits] = 6,
  [ac.FlagType.FasterCar] = 1, [ac.FlagType.Finished] = 5, [ac.FlagType.OneLapLeft] = 4,
}
local GREEN, AMBER, RED, DIM = rgbm(0.35, 0.85, 0.5, 1), rgbm(0.95, 0.75, 0.25, 1), rgbm(0.95, 0.4, 0.35, 1), rgbm(0.65, 0.65, 0.65, 1)
local SESSIONS = { [0] = 'Practice', 'Qualifying', 'Race', 'Hotlap', 'Time attack', 'Drift', 'Drag' }
local shown = { kind = 'wait', text = 'Starting', detail = 'Waiting for the bridge' }
local wait, busy = 0, false

local function car(i)
  local c = ac.getCar(i)
  local p = c.position
  return {
    i = i, name = ac.getDriverName(i), car = ac.getCarID(i), x = p.x, z = p.z,
    spl = c.splinePosition, laps = c.lapCount, pos = c.racePosition, kmh = c.speedKmh, gear = c.gear + 1,
    pit = c.isInPitlane and 1 or 0, cur = c.lapTimeMs, last = c.previousLapTimeMs, best = c.bestLapTimeMs,
    inv = c.isLapValid and 0 or 1,
  }
end

function script.update(dt)
  wait = wait - dt
  if sim.isInMainMenu then shown = { kind = 'wait', text = 'Waiting', detail = 'No session yet' } return end
  if wait > 0 or busy then return end
  wait = EVERY
  local cars = {}
  for i = 0, sim.carsCount - 1 do
    local c = ac.getCar(i)
    if c and c.isConnected then cars[#cars + 1] = car(i) end
  end
  local own = ac.getCar(0)
  local session = ac.getSession(sim.currentSessionIndex)
  local body = JSON.stringify({
    v = 1, t = sim.gameTime, root = ac.getFolder(ac.FolderID.Root), track = ac.getTrackID(), config = ac.getTrackLayout(),
    flag = flags[sim.raceFlagType] or 0, ses = math.max(0, sim.raceSessionType - 1), total = session and session.laps or 0,
    left = sim.sessionTimeLeft, cars = cars,
    valid = own.isLapValid and 1 or 0, wtemp = own.waterTemperature, wind = sim.windSpeedKmh / 3.6, wdir = math.rad(sim.windDirectionDeg),
    rain = sim.rainIntensity,
  })
  busy = true
  local ses = SESSIONS[math.max(0, sim.raceSessionType - 1)] or 'Session'
  web.post(URL, HEAD, body, function(err, response)
    busy = false
    shown = (err or (response and response.status >= 400))
      and { kind = 'error', text = 'Bridge not reachable', detail = 'Start it on this PC, port 9877' }
      or { kind = 'ok', text = 'Connected', detail = #cars .. (#cars == 1 and ' car' or ' cars') .. '  ·  ' .. ses }
  end)
end

function windowMain(dt)
  local c = shown.kind == 'ok' and GREEN or shown.kind == 'error' and RED or AMBER
  local at = ui.getCursor()
  ui.drawCircleFilled(at + vec2(7, 12), 5, c, 16)
  ui.setCursor(at + vec2(22, 0))
  ui.pushFont(ui.Font.Main)
  ui.textColored(shown.text, c)
  ui.popFont()
  ui.setCursor(at + vec2(22, 20))
  ui.pushFont(ui.Font.Small)
  ui.textColored(shown.detail, DIM)
  ui.popFont()
end
