import { RLP } from '@ethereumjs/rlp'
import { debug as createDebugLogger } from 'debug'
import { ecdsaRecover, ecdsaSign } from 'ethereum-cryptography/secp256k1-compat'
import { bytesToHex, bytesToUtf8, concatBytes } from 'ethereum-cryptography/utils'
import * as ip from 'ip'

import { assertEq, bytes2int, int2bytes, keccak256, unstrictDecode } from '../util'

import type { PeerInfo } from './dpt'

const debug = createDebugLogger('devp2p:dpt:server')

function getTimestamp() {
  return (Date.now() / 1000) | 0
}

const timestamp = {
  encode(value = getTimestamp() + 60) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value)
    return bytes
  },
  decode(bytes: Uint8Array) {
    if (bytes.length !== 4) throw new RangeError(`Invalid timestamp bytes :${bytesToHex(bytes)}`)
    return new DataView(bytes.buffer).getUint32(0)
  },
}

const address = {
  encode(value: string) {
    if (ip.isV4Format(value)) return Uint8Array.from(ip.toBuffer(value))
    if (ip.isV6Format(value)) return Uint8Array.from(ip.toBuffer(value))
    throw new Error(`Invalid address: ${value}`)
  },
  decode(bytes: Uint8Array) {
    if (bytes.length === 4) return ip.toString(Buffer.from(bytes))
    if (bytes.length === 16) return ip.toString(Buffer.from(bytes))

    const str = bytesToUtf8(bytes)
    if (ip.isV4Format(str) || ip.isV6Format(str)) return str

    // also can be host, but skip it right now (because need async function for resolve)
    throw new Error(`Invalid address bytes: ${bytesToHex(bytes)}`)
  },
}

const port = {
  encode(value: number | null): Uint8Array {
    if (value === null) return new Uint8Array()
    if (value >>> 16 > 0) throw new RangeError(`Invalid port: ${value}`)
    return Uint8Array.from([(value >>> 8) & 0xff, (value >>> 0) & 0xff])
  },
  decode(bytes: Uint8Array): number | null {
    if (bytes.length === 0) return null
    return bytes2int(bytes)
  },
}

const endpoint = {
  encode(obj: PeerInfo): Uint8Array[] {
    return [
      address.encode(obj.address!),
      port.encode(obj.udpPort ?? null),
      port.encode(obj.tcpPort ?? null),
    ]
  },
  decode(payload: Uint8Array[]): PeerInfo {
    return {
      address: address.decode(payload[0]),
      udpPort: port.decode(payload[1]),
      tcpPort: port.decode(payload[2]),
    }
  },
}

type InPing = { [0]: Uint8Array; [1]: Uint8Array[]; [2]: Uint8Array[]; [3]: Uint8Array }
type OutPing = { version: number; from: PeerInfo; to: PeerInfo; timestamp: number }
const ping = {
  encode(obj: OutPing): InPing {
    return [
      int2bytes(obj.version),
      endpoint.encode(obj.from),
      endpoint.encode(obj.to),
      timestamp.encode(obj.timestamp),
    ]
  },
  decode(payload: InPing): OutPing {
    return {
      version: bytes2int(payload[0]),
      from: endpoint.decode(payload[1]),
      to: endpoint.decode(payload[2]),
      timestamp: timestamp.decode(payload[3]),
    }
  },
}

type OutPong = { to: PeerInfo; hash: Uint8Array; timestamp: number }
type InPong = { [0]: Uint8Array[]; [1]: Uint8Array[]; [2]: Uint8Array }
const pong = {
  encode(obj: OutPong) {
    return [endpoint.encode(obj.to), obj.hash, timestamp.encode(obj.timestamp)]
  },
  decode(payload: InPong) {
    return {
      to: endpoint.decode(payload[0]),
      hash: payload[1],
      timestamp: timestamp.decode(payload[2]),
    }
  },
}

type OutFindMsg = { id: string; timestamp: number }
type InFindMsg = { [0]: string; [1]: Uint8Array }
const findneighbours = {
  encode(obj: OutFindMsg): InFindMsg {
    return [obj.id, timestamp.encode(obj.timestamp)]
  },
  decode(payload: InFindMsg): OutFindMsg {
    return {
      id: payload[0],
      timestamp: timestamp.decode(payload[1]),
    }
  },
}

type InNeighborMsg = { peers: PeerInfo[]; timestamp: number }
type OutNeighborMsg = { [0]: Uint8Array[][]; [1]: Uint8Array }
const neighbours = {
  encode(obj: InNeighborMsg): OutNeighborMsg {
    return [
      obj.peers.map((peer: PeerInfo) => endpoint.encode(peer).concat(peer.id! as Uint8Array)),
      timestamp.encode(obj.timestamp),
    ]
  },
  decode(payload: OutNeighborMsg): InNeighborMsg {
    return {
      peers: payload[0].map((data) => {
        return { endpoint: endpoint.decode(data), id: data[3] } // hack for id
      }),
      timestamp: timestamp.decode(payload[1]),
    }
  },
}

const messages: any = { ping, pong, findneighbours, neighbours }

type Types = { [index: string]: { [index: string]: number | string } }
const types: Types = {
  byName: {
    ping: 0x01,
    pong: 0x02,
    findneighbours: 0x03,
    neighbours: 0x04,
  },
  byType: {
    0x01: 'ping',
    0x02: 'pong',
    0x03: 'findneighbours',
    0x04: 'neighbours',
  },
}

// [0, 32) data hash
// [32, 96) signature
// 96 recoveryId
// 97 type
// [98, length) data

export function encode<T>(typename: string, data: T, privateKey: Uint8Array) {
  const type: number = types.byName[typename] as number
  if (type === undefined) throw new Error(`Invalid typename: ${typename}`)
  const encodedMsg = messages[typename].encode(data)
  const typedata = concatBytes(Uint8Array.from([type]), RLP.encode(encodedMsg))

  const sighash = keccak256(typedata)
  const sig = ecdsaSign(sighash, privateKey)
  const hashdata = concatBytes(sig.signature, Uint8Array.from([sig.recid]), typedata)
  const hash = keccak256(hashdata)
  return concatBytes(hash, hashdata)
}

export function decode(bytes: Uint8Array) {
  const hash = keccak256(bytes.slice(32))
  assertEq(bytes.slice(0, 32), hash, 'Hash verification failed', debug)

  const typedata = bytes.slice(97)
  const type = typedata[0]
  const typename = types.byType[type]
  if (typename === undefined) throw new Error(`Invalid type: ${type}`)
  const data = messages[typename].decode(unstrictDecode(typedata.slice(1)))

  const sighash = keccak256(typedata)
  const signature = bytes.slice(32, 96)
  const recoverId = bytes[96]
  const publicKey = ecdsaRecover(signature, recoverId, sighash, false)
  return { typename, data, publicKey }
}
