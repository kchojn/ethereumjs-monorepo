import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { ERROR } from '@ethereumjs/evm/dist/exceptions'
import { F, precompile09 } from '@ethereumjs/evm/dist/precompiles/09-blake2f'
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils'
import * as tape from 'tape'

import { VM } from '../../../src/vm'

// Test cases from:
// https://github.com/keep-network/go-ethereum/blob/1bccafe5ef54ba849e414ce7c90f7b7130634a9a/core/vm/contracts_test.go
const failingTestCases = [
  {
    input: '',
    err: ERROR.OUT_OF_RANGE,
    name: 'vector 0: empty input',
  },
  {
    input:
      '00000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    err: ERROR.OUT_OF_RANGE,
    name: 'vector 1: less than 213 bytes input',
  },
  {
    input:
      '000000000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    err: ERROR.OUT_OF_RANGE,
    name: 'vector 2: more than 213 bytes input',
  },
  {
    input:
      '0000000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000002',
    err: ERROR.OUT_OF_RANGE,
    name: 'vector 3: malformed final block indicator flag',
  },
]

const testCases = [
  {
    input:
      '0000000048c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    expected:
      '08c9bcf367e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d282e6ad7f520e511f6c3e2b8c68059b9442be0454267ce079217e1319cde05b',
    name: 'vector 4',
  },
  {
    input:
      '0000000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    expected:
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    name: 'vector 5',
  },
  {
    input:
      '0000000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000',
    expected:
      '75ab69d3190a562c51aef8d88f1c2775876944407270c42c9844252c26d2875298743e7f6d5ea2f2d3e8d226039cd31b4e426ac4f2d3d666a610c2116fde4735',
    name: 'vector 6',
  },
  {
    input:
      '0000000148c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    expected:
      'b63a380cb2897d521994a85234ee2c181b5f844d2c624c002677e9703449d2fba551b3a8333bcdf5f2f7e08993d53923de3d64fcc68c034e717b9293fed7a421',
    name: 'vector 7',
  },
  {
    input:
      '007A120048c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000001',
    expected:
      '6d2ce9e534d50e18ff866ae92d70cceba79bbcd14c63819fe48752c8aca87a4bb7dcc230d22a4047f0486cfcfb50a17b24b2899eb8fca370f22240adb5170189',
    name: 'vector 8',
  },
  {
    input:
      '0000000c48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b61626364650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000001',
    expected:
      'f3e89a60ec4b0b1854744984e421d22b82f181bd4601fb9b1726b2662da61c29dff09e75814acb2639fd79e56616e55fc135f8476f0302b3dc8d44e082eb83a8',
    name: 'vector 9',
  },
]

tape('Istanbul: EIP-152', (t) => {
  t.test('Blake2f', async (st) => {
    if (globalThis.navigator !== undefined && globalThis.navigator.userAgent.includes('Firefox')) {
      // TODO: investigate why this test hangs in karma with firefox
      return st.end()
    }

    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Istanbul })
    const vm = await VM.create({ common })

    for (const testCase of failingTestCases) {
      st.comment(testCase.name)
      const res = precompile09({
        data: hexToBytes(testCase.input),
        gasLimit: BigInt(20),
        _common: common,
        _EVM: vm.evm,
      })
      st.equal(res.exceptionError?.error, testCase.err)
    }

    for (const testCase of testCases) {
      st.comment(testCase.name)
      const res = precompile09({
        data: hexToBytes(testCase.input),
        gasLimit: BigInt(10000000),
        _common: common,
        _EVM: vm.evm,
      })
      st.equal(bytesToHex(res.returnValue), testCase.expected)
    }

    st.end()
  })
})

// Test case from:
// https://github.com/keep-network/go-ethereum/blob/1bccafe5ef54ba849e414ce7c90f7b7130634a9a/crypto/blake2b/blake2b_f_test.go
// prettier-ignore
const fTestCases = [
  {
    hIn: new Uint32Array([0xf2bdc948, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,]),
    m: new Uint32Array([0x00636261, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,]),
    t: new Uint32Array([3, 0, 0, 0]),
    f: true,
    rounds: 12,
    hOut: new Uint32Array([0x3fa580ba, 0x0d4d1c98, 0xb697276a, 0xe9f6129f, 0x142f214c, 0xb7c45a68, 0x6fbb124b, 0xd1a2ffdb, 0x39c5877d, 0x2d79ab2a, 0xded552c2, 0x95cc3345, 0xa88ad318, 0x5a92f1db, 0xed8623b9, 0x239900d4,]),
  },
]

tape('Blake2', (t) => {
  t.test('F', (st) => {
    for (const testCase of fTestCases) {
      F(testCase.hIn, testCase.m, testCase.t, testCase.f, testCase.rounds)
      st.deepEqual(testCase.hIn, testCase.hOut)
    }

    st.end()
  })
})
