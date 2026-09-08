interface BluetoothRemoteGATTCharacteristic extends EventTarget { value?: DataView; readValue():Promise<DataView>; startNotifications():Promise<BluetoothRemoteGATTCharacteristic>; addEventListener(type:'characteristicvaluechanged',listener:EventListener):void; removeEventListener(type:'characteristicvaluechanged',listener:EventListener):void }
interface BluetoothRemoteGATTService { getCharacteristic(characteristic:number):Promise<BluetoothRemoteGATTCharacteristic> }
interface BluetoothRemoteGATTServer { connected:boolean; connect():Promise<BluetoothRemoteGATTServer>; disconnect():void; getPrimaryService(service:number):Promise<BluetoothRemoteGATTService> }
interface BluetoothDevice extends EventTarget { name?:string; gatt?:BluetoothRemoteGATTServer; addEventListener(type:'gattserverdisconnected',listener:EventListener):void }
interface Bluetooth { requestDevice(options:unknown):Promise<BluetoothDevice> }
interface Navigator { bluetooth?:Bluetooth }
