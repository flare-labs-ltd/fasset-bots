import { provider, addresses, getContext } from './config'
import { sleep } from './util'
import { Liquidator } from './liquidator'

const SLEEP_TIME_MS = 1000 * 10
const context = getContext(provider, addresses)

async function main() {
  const liquidator = new Liquidator(context)
  await liquidator.init()
  while (true) {
    await liquidator.runArbitrage()
    await sleep(SLEEP_TIME_MS)
  }
}

main()