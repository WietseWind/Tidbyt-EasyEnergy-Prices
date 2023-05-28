import sharp from 'sharp'
import fetch from 'node-fetch'
import {DOMParser} from 'xmldom'

/* ************************************************ */

sharp.cache(false)

const device = process.env.DEVICE
const apikey = process.env.APIKEY

/* ************************************************ */

const date = new Date()

const brightness = date.getHours() > 7 && date.getHours() < 21 ? 50 : 25

date.setHours(0, 0, 0, 0)
const startDate = encodeURIComponent(date.toISOString())
date.setHours(24, 0, 0, 0)
const endDate = encodeURIComponent(date.toISOString())

const c = await fetch(`https://mijn.easyenergy.com/nl/api/tariff/GetApxTariffs?startTimestamp=${startDate}&endTimestamp=${endDate}`)

const parser = new DOMParser()
const document = parser.parseFromString(await c.text(), 'text/xml')
const tariffs = JSON.parse(document.firstChild.data)
const hourlyRates = tariffs.map(t => t.TariffUsage * 100)

/* ************************************************ */

const maxCt = Math.ceil(Math.max(...hourlyRates))
const minCt = Math.floor(Math.min(...hourlyRates))
const diffCt = maxCt - minCt

const ctHeight =  minCt < 0  // Reserve 1 px for straight zero line
  ? (32 - 1) / diffCt
  : (32 - 1) / maxCt

const zero = minCt < 0
  ? Math.floor(maxCt * ctHeight)
  : 31

console.log({ maxCt, minCt, diffCt, ctHeight, zero })

let pos = 0

const [ _midnightTill7, _7till12, _12till18, _18tillNight ] = [0, 1, 2, 3].map(section => {
  const rates = hourlyRates.slice(section * 6, (section + 1) * 6)
  return rates.map((r, i) => {
    if (i === 0 && section > 0) {
      pos += 2
    }

    const width = section === 1 || section === 2
      ? 2
      : 2

    const x = pos

    const y = r < 0
      ? zero + 1
      : (maxCt - r) * ctHeight
  
    const height = Math.abs(r * ctHeight)

    pos += width
    pos += section === 2 ? 2 : 0

    const fill = section === 0 || section === 3
      ? 'white'
      : section === 1
        ? '#F3C144'
        : '#7069E8'
  
    return `
      <rect x="${x}" y="${y}" fill="${fill}" height="${height}" width="${width}" />
    `
  })
})

const render = async res => {
  const composites = []

  const svg = `
    <svg width="64" fill="black" height="32" viewBox="0 0 64 32" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      ${minCt < 0 ? `<rect x="0" y="${zero}" fill="#519B53" opacity=".3" height="${32-zero}" width="64" />` : ``}
      ${_midnightTill7}
      ${_7till12}
      ${_12till18}
      ${_18tillNight}
      <rect x="0" y="${zero}" fill="black" height="1" width="64" />
    </svg>
  `
  
  composites.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), top: 0, left: 0 })

  const output =
    await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 }, } })
      .ensureAlpha().composite(composites).gif().toBuffer()
  
  const buf = Buffer.from(output, 'binary')

  await fetch('https://api.tidbyt.com/v0/devices/' + device, {
    method: 'PATCH', headers: { 'Content-type': 'application/json', 'Authorization': 'Bearer ' + apikey },
    body: JSON.stringify({ brightness, autoDim: false, })
  })

  const f = await fetch('https://api.tidbyt.com/v0/devices/' + device + '/push', {
    method: 'POST',
    headers: { 'Content-type': 'application/json', 'Authorization': 'Bearer ' + apikey },
    body: JSON.stringify({ image: buf.toString('base64'), background: false, installationID: 'nodejs', })
  })

  console.log('Rendered & live', await f.json())

  return buf
}

render()
