class Microphone {
    constructor() {
        this.record = !1,
        this.position = 0,
        this.sampleRate = this.getDeviceCaps()[0],
        this.channels = 2,
        this.duration = 0,
        this.initialized = !1,
        this.permissionGranted = !1,
        this.mediaAvailable = !1,
        this.audioContext = null,
        this.requestingMedia = !1,
        this.leapSync = !1,
        this.mediaStreamSource = null,
        this.audioWorkletNode = null,
        this.devicesList = [],
        this.deviceKinds = {
            VideoInput: "videoinput",
            AudioInput: "audioinput",
            AudioOutput: "audioinput"
        },
        this.delayedInitialize(this),
        this.check()
    }
    delayedInitialize(e) {
        var i = document.querySelector("#unity-canvas"),
        t = null;
        t = () => {
            i.removeEventListener("touchstart", t, { passive: true });
            i.removeEventListener("mousedown", t);
            setTimeout(() => {
                e.initialize(e);
            }, 100);
        };
        i.addEventListener("touchstart", t, { passive: true });
        i.addEventListener("mousedown", t);
    }
    async initialize(e) {
        e.initialized || (e.audioContext = new(window.AudioContext || window.webKitAudioContext), await e.audioContext.audioWorklet.addModule("./mic-worklet-module.js"), e.audioWorkletNode = new AudioWorkletNode(e.audioContext, "microphone-worklet"), e.audioWorkletNode.port.onmessage = i => {
                e.nodeInputHandler(e, i)
            }, e.initialized = !0, Microphone.log("initialized"))
    }
    async check() {
        await this.refreshDevices(),
        await this.refreshDevices(),
        setInterval(() => {
            this.permissionStatusHandler(this)
        }, 2e3)
    }
    getDeviceCaps() {
        return [16e3, 48e3]
    }
    getPosition() {
        return this.position
    }
    isRecording() {
        return this.record
    }
    start(e, i, t, a) {
        if (!0 === this.record || !0 === this.requestingMedia || !1 === this.initialized)
            return;
        this.sampleRate = i,
        this.position = 0,
        this.loop = t,
        this.duration = a;
        let s = this.audioWorkletNode.parameters.get("frequency");
        s.setValueAtTime(this.sampleRate, this.audioContext.currentTime);
        let o = this.audioWorkletNode.parameters.get("channels");
        if (o.setValueAtTime(this.channels, this.audioContext.currentTime), this.requestingMedia = !0, navigator.mediaDevices.getUserMedia) {
            var n = null;
            n = null !== e && navigator.mediaDevices.getSupportedConstraints().deviceId ? {
                audio: {
                    deviceId: {
                        exact: e
                    }
                }
            }
             : {
                audio: !0
            },
            navigator.mediaDevices.getUserMedia(n).then(e => {
                this.mediaGranted(this, e)
            }).catch(e => {
                this.mediaFailed(this, e)
            })
        }
    }
    end() {
        if (!1 === this.record || !0 === this.requestingMedia || !1 === this.initialized || null === this.mediaStreamSource)
            return;
        let e = this.audioWorkletNode.parameters.get("recording");
        e.setValueAtTime(0, this.audioContext.currentTime),
        this.record = !1,
        this.mediaAvailable = !1,
        this.mediaStreamSource.mediaStream.getTracks().forEach(e => e.stop()),
        this.leapSync && this.mediaStreamSource.disconnect(this.audioContext.destination),
        this.mediaStreamSource.disconnect(this.audioWorkletNode),
        Microphone.log("end")
    }
    devices() {
        return this.devicesList
    }
    devicePermitted(e) {
        let i = this.devices(),
        t = !!i.find(i => i.kind === e && !!i.label);
        return t
    }
    setLeapSync(e) {
        this.leapSync = e
    }
    mediaGranted(e, i) {
        let t = e.audioWorkletNode.parameters.get("recording");
        t.setValueAtTime(1, e.audioContext.currentTime),
        e.mediaAvailable = !0,
        e.requestingMedia = !1,
        e.record = !0,
        e.mediaStreamSource = e.audioContext.createMediaStreamSource(i),
        e.mediaStreamSource.connect(e.audioWorkletNode),
        e.leapSync && e.mediaStreamSource.connect(e.audioContext.destination),
        Microphone.log("start")
    }
    mediaFailed(e, i) {
        e.mediaAvailable = !1,
        e.requestingMedia = !1,
        Microphone.log("media stream denied"),
        Microphone.log(i)
    }
    async refreshDevices() {
        if (navigator.mediaDevices?.enumerateDevices) {
            if (!this.mediaAvailable)
                try {
                    await navigator.mediaDevices.getUserMedia({
                        audio: !0
                    })
                } catch (e) {
                    this.devicesList = [];
                    return
                }
            var i = await navigator.mediaDevices.enumerateDevices();
            this.devicesList = [];
            for (var t = 0; t < i.length; t++)
                if (i[t].kind === this.deviceKinds.AudioInput) {
                    var a = {
                        deviceId: i[t].deviceId,
                        kind: i[t].kind,
                        label: i[t].label,
                        groupId: i[t].groupId
                    };
                    this.devicesList.push(a)
                }
        }
    }
    nodeInputHandler(e, i) {
        if (!e.record || e.position / e.sampleRate >= e.duration && !e.loop)
            return;
        let t = i.data;
        if (void 0 == t || void 0 == t.data[0])
            return;
        let a = Math.min(t.channels, this.channels),
        s = t.data[0].length,
        o = t.data,
        n = document.microphoneNative.samplesMemoryDataLeftChannel.length,
        r = e.position,
        d = 0;
        for (let c = 0; c < s; c++) {
            for (let l = 0; l < a; l++)
                0 == l ? document.microphoneNative.samplesMemoryDataLeftChannel[e.position] = o[l][c] : document.microphoneNative.samplesMemoryDataRightChannel[e.position] = o[l][c];
            if (e.position++, e.position + 1 > n) {
                if (e.loop)
                    e.position = 0;
                else {
                    e.position = Math.max(0, n - 1);
                    break
                }
            }
            d++
        }
        document.microphoneNative.unityCommand("StreamChunkReceived", r + ":" + d)
    }
    async permissionStatusHandler(e) {
        await e.refreshDevices();
        let i = e.devicePermitted(e.deviceKinds.AudioInput);
        e.permissionGranted !== i && e.setPermissionStatus(i)
    }
    setPermissionStatus(e) {
        this.permissionGranted = e,
        document.microphoneNative.unityCommand("PermissionChanged", this.permissionGranted)
    }
    static log(e) {
        console.log("[Unity][WebGL][Microphone]: " + e)
    }
}
