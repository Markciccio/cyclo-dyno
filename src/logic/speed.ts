export function calculateVirtualSpeed(powerWatts:number, referenceWatts=250, referenceKmh=36) { return powerWatts<=0?0:referenceKmh*Math.cbrt(powerWatts/referenceWatts) }
