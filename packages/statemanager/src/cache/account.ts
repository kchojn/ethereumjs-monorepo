import { debug as createDebugLogger } from 'debug'
import { OrderedMap } from 'js-sdsl'

import { Cache } from './cache'

import type { CacheOpts } from './types'
import type { Account, Address } from '@ethereumjs/util'

/**
 * account: undefined
 *
 * Account is known to not exist in the trie
 */
type AccountCacheElement = {
  accountRLP: Buffer | undefined
}

export class AccountCache extends Cache<AccountCacheElement> {
  constructor(opts: CacheOpts) {
    super(opts)
    this._debug = createDebugLogger('statemanager:cache:account')
  }

  _saveCachePreState(cacheKeyHex: string) {
    const it = this._diffCache[this._checkpoints].find(cacheKeyHex)
    if (it.equals(this._diffCache[this._checkpoints].end())) {
      let oldElem
      if (this._lruCache) {
        oldElem = this._lruCache!.get(cacheKeyHex)
      } else {
        oldElem = this._orderedMapCache!.getElementByKey(cacheKeyHex)
      }
      this._diffCache[this._checkpoints].setElement(cacheKeyHex, oldElem)
    }
  }

  /**
   * Puts account to cache under its address.
   * @param key - Address of account or undefined if account doesn't exist in the trie
   * @param val - Account
   */
  put(address: Address, account: Account | undefined): void {
    const addressHex = address.buf.toString('hex')
    this._saveCachePreState(addressHex)
    const elem = {
      accountRLP: account !== undefined ? account.serialize() : undefined,
    }

    if (this.DEBUG) {
      this._debug(`Put account ${addressHex}`)
    }
    if (this._lruCache) {
      this._lruCache!.set(addressHex, elem)
    } else {
      this._orderedMapCache!.setElement(addressHex, elem)
    }
    this._stats.writes += 1
  }

  /**
   * Returns the queried account or undefined if account doesn't exist
   * @param key - Address of account
   */
  get(address: Address): AccountCacheElement | undefined {
    const addressHex = address.buf.toString('hex')
    if (this.DEBUG) {
      this._debug(`Get account ${addressHex}`)
    }

    let elem
    if (this._lruCache) {
      elem = this._lruCache!.get(addressHex)
    } else {
      elem = this._orderedMapCache!.getElementByKey(addressHex)
    }
    this._stats.reads += 1
    if (elem) {
      this._stats.hits += 1
    }
    return elem
  }

  /**
   * Marks address as deleted in cache.
   * @param key - Address
   */
  del(address: Address): void {
    const addressHex = address.buf.toString('hex')
    this._saveCachePreState(addressHex)
    if (this.DEBUG) {
      this._debug(`Delete account ${addressHex}`)
    }
    if (this._lruCache) {
      this._lruCache!.set(addressHex, {
        accountRLP: undefined,
      })
    } else {
      this._orderedMapCache!.setElement(addressHex, {
        accountRLP: undefined,
      })
    }

    this._stats.dels += 1
  }

  /**
   * Flushes cache by returning accounts that have been modified
   * or deleted and resetting the diff cache (at checkpoint height).
   */
  async flush(): Promise<[string, AccountCacheElement][]> {
    if (this.DEBUG) {
      this._debug(`Flushing cache on checkpoint ${this._checkpoints}`)
    }

    const diffMap = this._diffCache[this._checkpoints]!
    const it = diffMap.begin()

    const items: [string, AccountCacheElement][] = []

    while (!it.equals(diffMap.end())) {
      const cacheKeyHex = it.pointer[0]
      let elem
      if (this._lruCache) {
        elem = this._lruCache!.get(cacheKeyHex)
      } else {
        elem = this._orderedMapCache!.getElementByKey(cacheKeyHex)
      }

      if (elem !== undefined) {
        items.push([cacheKeyHex, elem])
      }
      it.next()
    }
    this._diffCache[this._checkpoints] = new OrderedMap()
    return items
  }

  /**
   * Revert changes to cache last checkpoint (no effect on trie).
   */
  revert(): void {
    this._checkpoints -= 1
    if (this.DEBUG) {
      this._debug(`Revert to checkpoint ${this._checkpoints}`)
    }
    const diffMap = this._diffCache.pop()!

    const it = diffMap.begin()
    while (!it.equals(diffMap.end())) {
      const addressHex = it.pointer[0]
      const elem = it.pointer[1]
      if (elem === undefined) {
        if (this._lruCache) {
          this._lruCache!.delete(addressHex)
        } else {
          this._orderedMapCache!.eraseElementByKey(addressHex)
        }
      } else {
        if (this._lruCache) {
          this._lruCache!.set(addressHex, elem)
        } else {
          this._orderedMapCache!.setElement(addressHex, elem)
        }
      }
      it.next()
    }
  }

  /**
   * Commits to current state of cache (no effect on trie).
   */
  commit(): void {
    this._checkpoints -= 1
    if (this.DEBUG) {
      this._debug(`Commit to checkpoint ${this._checkpoints}`)
    }
    const diffMap = this._diffCache.pop()!

    const it = diffMap.begin()
    while (!it.equals(diffMap.end())) {
      const addressHex = it.pointer[0]
      const element = it.pointer[1]
      const oldElem = this._diffCache[this._checkpoints].getElementByKey(addressHex)
      if (oldElem === undefined) {
        this._diffCache[this._checkpoints].setElement(addressHex, element)
      }
      it.next()
    }
  }
}
