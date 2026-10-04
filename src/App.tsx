import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  FileCode,
  Sliders,
  CheckCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import {
  ConnectionState,
  SerialLogEntry,
  MotorScheduleConfig,
  MotorDeviceState,
  ArduinoConfig,
  AngleOption,
} from './types/serial';
import {
  serialManager,
  playTactileTone,
  triggerHaptic,
} from './services/serialService';
import { ConnectionCard } from './components/ConnectionCard';
import { ThreeButtonControl } from './components/ThreeButtonControl';
import { ArduinoVisualizer } from './components/ArduinoVisualizer';
import { SerialMonitor } from './components/SerialMonitor';
import { ArduinoCodeModal } from './components/ArduinoCodeModal';
import { SettingsModal } from './components/SettingsModal';

const DEFAULT_CONFIG: ArduinoConfig = {
  baudRate: 9600,
  commandMotor1: 'M1',
  commandJeda: 'JEDA',
  commandMotor2: 'M2',
  lineEnding: '\n',
  hapticFeedback: true,
  soundFeedback: true,
};

const DEFAULT_SCHEDULE: MotorScheduleConfig = {
  motor1Seconds: 4,
  jedaSeconds: 8, // Asumsi default 8 detik jeda (minimal 2 detik)
  motor2Seconds: 4,
  motor1Angle: 90,
  motor2Angle: 90,
  operationMode: 'continuous',
  timedMinutes: 15,
};

export default function App() {
  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectionInfo, setConnectionInfo] = useState<string>('Belum Terhubung');
  const [isSimulated, setIsSimulated] = useState<boolean>(false);

  // Serial hardware activity indicators
  const [rxActive, setRxActive] = useState<boolean>(false);
  const [txActive, setTxActive] = useState<boolean>(false);
  const rxTimerRef = useRef<NodeJS.Timeout | null>(null);
  const txTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Configuration for Motor Schedule and Serial
  const [scheduleConfig, setScheduleConfig] = useState<MotorScheduleConfig>(DEFAULT_SCHEDULE);
  const [config, setConfig] = useState<ArduinoConfig>(DEFAULT_CONFIG);

  // Device state for live simulation & runner
  const [deviceState, setDeviceState] = useState<MotorDeviceState>({
    isRunning: false,
    currentPhase: 'idle',
    phaseSecondsLeft: 0,
    totalSecondsLeft: DEFAULT_SCHEDULE.timedMinutes * 60,
    motor1Angle: 0,
    motor2Angle: 0,
    motor1Direction: 'diam',
    motor2Direction: 'diam',
    motor1TargetAngle: DEFAULT_SCHEDULE.motor1Angle,
    motor2TargetAngle: DEFAULT_SCHEDULE.motor2Angle,
    cycleCount: 0,
    pinStates: {
      pinServo1: false,
      pinServo2: false,
      pinStatusLed: false,
    },
  });

  // Runner interval reference
  const runnerTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentPhaseRef = useRef<MotorDeviceState['currentPhase']>('idle');
  const phaseSecondsLeftRef = useRef<number>(0);
  const totalSecondsLeftRef = useRef<number>(0);
  const cycleCountRef = useRef<number>(0);

  // Logs & Modals
  const [logs, setLogs] = useState<SerialLogEntry[]>([]);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warn' } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'warn' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const triggerRxActivity = useCallback(() => {
    setRxActive(true);
    if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
    rxTimerRef.current = setTimeout(() => setRxActive(false), 200);
  }, []);

  const triggerTxActivity = useCallback(() => {
    setTxActive(true);
    if (txTimerRef.current) clearTimeout(txTimerRef.current);
    txTimerRef.current = setTimeout(() => setTxActive(false), 200);
  }, []);

  // Update schedule configuration
  const handleUpdateScheduleConfig = (updated: Partial<MotorScheduleConfig>) => {
    setScheduleConfig((prev) => {
      const next = { ...prev, ...updated };
      // Enforce minimum 2 seconds for jeda
      if (next.jedaSeconds < 2) next.jedaSeconds = 2;
      return next;
    });

    if (updated.motor1Angle) {
      setDeviceState((prev) => ({ ...prev, motor1TargetAngle: updated.motor1Angle! }));
    }
    if (updated.motor2Angle) {
      setDeviceState((prev) => ({ ...prev, motor2TargetAngle: updated.motor2Angle! }));
    }
  };

  // Initialize Serial Service callbacks
  useEffect(() => {
    serialManager.setCallbacks({
      onStateChange: (state, info) => {
        setConnectionState(state);
        if (info) setConnectionInfo(info);
        setIsSimulated(serialManager.getIsSimulated());

        if (state === 'connected') {
          showToast('Perangkat Berhasil Terhubung!', 'success');
          if (config.hapticFeedback) triggerHaptic(80);
          if (config.soundFeedback) playTactileTone(1200, 70);
        } else if (state === 'disconnected') {
          showToast('Koneksi Perangkat Terputus.', 'warn');
          handleStop();
        }
      },
      onLog: (entry) => {
        setLogs((prev) => [...prev.slice(-150), entry]);
        if (entry.type === 'rx') triggerRxActivity();
        else if (entry.type === 'tx') triggerTxActivity();
      },
      onRxActivity: triggerRxActivity,
      onTxActivity: triggerTxActivity,
    });

    // Initial welcome logs
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    setLogs([
      {
        id: 'init-1',
        timestamp: timeStr,
        type: 'sys',
        message: 'Aplikasi Siap. Servo Motor 1 (Pin D9) & Servo Motor 2 (Pin D10).',
      },
      {
        id: 'init-2',
        timestamp: timeStr,
        type: 'sys',
        message: 'Perhatian: Matikan adaptor/listrik sebelum menghubungkan kabel USB.',
      },
    ]);
  }, [showToast, config.hapticFeedback, config.soundFeedback, triggerRxActivity, triggerTxActivity]);

  // Connect via USB OTG
  const handleConnectReal = async () => {
    if (config.soundFeedback) playTactileTone(700, 30);
    const success = await serialManager.connectReal(config.baudRate);
    if (!success && !serialManager.isWebSerialSupported()) {
      showToast('Browser belum mendukung Web Serial langsung. Aktifkan Mode Simulasi.', 'warn');
    }
  };

  // Toggle simulation mode
  const handleToggleSimulated = () => {
    if (config.soundFeedback) playTactileTone(800, 30);
    if (connectionState === 'connected' && isSimulated) {
      serialManager.disconnect();
    } else {
      serialManager.connectSimulated(config.baudRate);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    if (config.soundFeedback) playTactileTone(400, 30);
    handleStop();
    await serialManager.disconnect();
  };

  // Stop running sequence
  const handleStop = useCallback(() => {
    if (runnerTimerRef.current) {
      clearInterval(runnerTimerRef.current);
      runnerTimerRef.current = null;
    }

    currentPhaseRef.current = 'idle';
    setDeviceState((prev) => ({
      ...prev,
      isRunning: false,
      currentPhase: 'idle',
      phaseSecondsLeft: 0,
      motor1Angle: 0,
      motor2Angle: 0,
      motor1Direction: 'diam',
      motor2Direction: 'diam',
      pinStates: { pinServo1: false, pinServo2: false, pinStatusLed: false },
    }));

    if (connectionState === 'connected') {
      serialManager.sendCommand('STOP', config.lineEnding);
    }

    if (config.soundFeedback) playTactileTone(350, 60);
    if (config.hapticFeedback) triggerHaptic(40);
  }, [connectionState, config.lineEnding, config.soundFeedback, config.hapticFeedback]);

  // Apply and Start the Cycle Sequence
  const handleApply = async () => {
    if (connectionState !== 'connected') {
      showToast('Perangkat belum terhubung! Silakan hubungkan USB atau aktifkan Mode Simulasi.', 'warn');
      if (config.soundFeedback) playTactileTone(250, 90);
      return;
    }

    // Validate jeda
    const safeJeda = Math.max(2, scheduleConfig.jedaSeconds);

    if (config.soundFeedback) playTactileTone(1000, 50);
    if (config.hapticFeedback) triggerHaptic(60);

    // Prepare serial command
    const serialPayload = `START:M1=${scheduleConfig.motor1Seconds}s_${scheduleConfig.motor1Angle}deg,JEDA=${safeJeda}s,M2=${scheduleConfig.motor2Seconds}s_${scheduleConfig.motor2Angle}deg,MODE=${scheduleConfig.operationMode},TIME=${scheduleConfig.timedMinutes}m`;
    await serialManager.sendCommand(serialPayload, config.lineEnding);

    showToast('✓ Pengaturan DITERAPKAN! Siklus Motor Dimulai.', 'success');

    // Initialize sequence state
    if (runnerTimerRef.current) clearInterval(runnerTimerRef.current);

    currentPhaseRef.current = 'motor1';
    phaseSecondsLeftRef.current = scheduleConfig.motor1Seconds;
    totalSecondsLeftRef.current = scheduleConfig.timedMinutes * 60;
    cycleCountRef.current = 0;

    setDeviceState({
      isRunning: true,
      currentPhase: 'motor1',
      phaseSecondsLeft: scheduleConfig.motor1Seconds,
      totalSecondsLeft: scheduleConfig.timedMinutes * 60,
      motor1Angle: scheduleConfig.motor1Angle,
      motor2Angle: 0,
      motor1Direction: 'maju',
      motor2Direction: 'diam',
      motor1TargetAngle: scheduleConfig.motor1Angle,
      motor2TargetAngle: scheduleConfig.motor2Angle,
      cycleCount: 0,
      pinStates: { pinServo1: true, pinServo2: false, pinStatusLed: true },
    });

    // Start 1-second interval state machine runner
    runnerTimerRef.current = setInterval(() => {
      // Handle total countdown if timed mode
      if (scheduleConfig.operationMode === 'timed') {
        totalSecondsLeftRef.current -= 1;
        if (totalSecondsLeftRef.current <= 0) {
          handleStop();
          showToast('Operasi Selesai: Batas Waktu Menit Telah Tercapai!', 'success');
          return;
        }
      }

      // Handle current phase countdown
      phaseSecondsLeftRef.current -= 1;

      if (phaseSecondsLeftRef.current <= 0) {
        // Phase transition logic
        if (currentPhaseRef.current === 'motor1') {
          // Transition to Jeda
          currentPhaseRef.current = 'jeda';
          phaseSecondsLeftRef.current = safeJeda;
          serialManager.sendCommand('PHASE:JEDA', config.lineEnding);

          setDeviceState((prev) => ({
            ...prev,
            currentPhase: 'jeda',
            phaseSecondsLeft: safeJeda,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor1Angle: 0,
            motor2Angle: 0,
            motor1Direction: 'diam',
            motor2Direction: 'diam',
            pinStates: { pinServo1: false, pinServo2: false, pinStatusLed: false },
          }));
        } else if (currentPhaseRef.current === 'jeda') {
          // Transition to Motor 2
          currentPhaseRef.current = 'motor2';
          phaseSecondsLeftRef.current = scheduleConfig.motor2Seconds;
          serialManager.sendCommand('PHASE:MOTOR2', config.lineEnding);

          setDeviceState((prev) => ({
            ...prev,
            currentPhase: 'motor2',
            phaseSecondsLeft: scheduleConfig.motor2Seconds,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor1Angle: 0,
            motor2Angle: scheduleConfig.motor2Angle,
            motor1Direction: 'diam',
            motor2Direction: 'maju',
            pinStates: { pinServo1: false, pinServo2: true, pinStatusLed: true },
          }));
        } else if (currentPhaseRef.current === 'motor2') {
          // Transition to Loop / Next Cycle (Motor 1)
          cycleCountRef.current += 1;
          const nextCycle = cycleCountRef.current;

          currentPhaseRef.current = 'motor1';
          phaseSecondsLeftRef.current = scheduleConfig.motor1Seconds;
          serialManager.sendCommand(`CYCLE:#${nextCycle + 1}_MOTOR1`, config.lineEnding);

          setDeviceState((prev) => ({
            ...prev,
            currentPhase: 'motor1',
            cycleCount: nextCycle,
            phaseSecondsLeft: scheduleConfig.motor1Seconds,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor1Angle: scheduleConfig.motor1Angle,
            motor2Angle: 0,
            motor1Direction: 'maju',
            motor2Direction: 'diam',
            pinStates: { pinServo1: true, pinServo2: false, pinStatusLed: true },
          }));
        }
      } else {
        // In-phase sub-tick: calculate forward vs return motion
        if (currentPhaseRef.current === 'motor1') {
          const isForward = phaseSecondsLeftRef.current > scheduleConfig.motor1Seconds / 2;
          setDeviceState((prev) => ({
            ...prev,
            phaseSecondsLeft: phaseSecondsLeftRef.current,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor1Angle: isForward ? scheduleConfig.motor1Angle : 0,
            motor1Direction: isForward ? 'maju' : 'kembali',
            motor2Angle: 0,
            motor2Direction: 'diam',
          }));
        } else if (currentPhaseRef.current === 'motor2') {
          const isForward = phaseSecondsLeftRef.current > scheduleConfig.motor2Seconds / 2;
          setDeviceState((prev) => ({
            ...prev,
            phaseSecondsLeft: phaseSecondsLeftRef.current,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor2Angle: isForward ? scheduleConfig.motor2Angle : 0,
            motor2Direction: isForward ? 'maju' : 'kembali',
            motor1Angle: 0,
            motor1Direction: 'diam',
          }));
        } else {
          // Jeda: both rest at 0
          setDeviceState((prev) => ({
            ...prev,
            phaseSecondsLeft: phaseSecondsLeftRef.current,
            totalSecondsLeft: totalSecondsLeftRef.current,
            motor1Angle: 0,
            motor2Angle: 0,
            motor1Direction: 'diam',
            motor2Direction: 'diam',
          }));
        }
      }
    }, 1000);
  };

  // Test single motor or pause directly (simulating 0 -> angle -> 0)
  const handleTestSingle = async (target: 'motor1' | 'jeda' | 'motor2') => {
    if (connectionState !== 'connected') {
      showToast('Hubungkan USB atau aktifkan simulasi terlebih dahulu.', 'warn');
      return;
    }

    if (config.soundFeedback) playTactileTone(800, 40);
    if (config.hapticFeedback) triggerHaptic(30);

    if (target === 'motor1') {
      await serialManager.sendCommand(`TEST:MOTOR1_0_TO_${scheduleConfig.motor1Angle}_TO_0`, config.lineEnding);
      // Maju ke target
      setDeviceState((prev) => ({
        ...prev,
        motor1Angle: scheduleConfig.motor1Angle,
        motor1Direction: 'maju',
        motor2Angle: 0,
        motor2Direction: 'diam',
      }));
      // Kembali ke 0 derajat
      setTimeout(() => {
        setDeviceState((prev) => ({
          ...prev,
          motor1Angle: 0,
          motor1Direction: 'kembali',
        }));
        setTimeout(() => {
          setDeviceState((prev) => ({ ...prev, motor1Direction: 'diam' }));
        }, 800);
      }, 900);
      showToast(`Uji Motor 1: 0° ➔ ${scheduleConfig.motor1Angle}° ➔ 0°`, 'success');
    } else if (target === 'motor2') {
      await serialManager.sendCommand(`TEST:MOTOR2_0_TO_${scheduleConfig.motor2Angle}_TO_0`, config.lineEnding);
      // Maju ke target
      setDeviceState((prev) => ({
        ...prev,
        motor2Angle: scheduleConfig.motor2Angle,
        motor2Direction: 'maju',
        motor1Angle: 0,
        motor1Direction: 'diam',
      }));
      // Kembali ke 0 derajat
      setTimeout(() => {
        setDeviceState((prev) => ({
          ...prev,
          motor2Angle: 0,
          motor2Direction: 'kembali',
        }));
        setTimeout(() => {
          setDeviceState((prev) => ({ ...prev, motor2Direction: 'diam' }));
        }, 800);
      }, 900);
      showToast(`Uji Motor 2: 0° ➔ ${scheduleConfig.motor2Angle}° ➔ 0°`, 'success');
    } else {
      await serialManager.sendCommand(`TEST:JEDA_${Math.max(2, scheduleConfig.jedaSeconds)}SEC`, config.lineEnding);
      setDeviceState((prev) => ({
        ...prev,
        motor1Angle: 0,
        motor2Angle: 0,
        motor1Direction: 'diam',
        motor2Direction: 'diam',
      }));
      showToast(`Uji Jeda Diam: ${Math.max(2, scheduleConfig.jedaSeconds)} detik`, 'success');
    }
  };

  // Test manual angle from visualizer
  const handleApplyManualAngle = async (motor: 'motor1' | 'motor2', angle: AngleOption) => {
    if (motor === 'motor1') {
      handleUpdateScheduleConfig({ motor1Angle: angle });
      setDeviceState((prev) => ({ ...prev, motor1Angle: angle, motor1TargetAngle: angle }));
      if (connectionState === 'connected') {
        await serialManager.sendCommand(`SET:M1_ANGLE=${angle}`, config.lineEnding);
      }
      setTimeout(() => {
        if (!deviceState.isRunning) {
          setDeviceState((prev) => ({ ...prev, motor1Angle: 0 }));
        }
      }, 1200);
      showToast(`Sudut Motor 1 diubah & diuji: ${angle}°`, 'success');
    } else {
      handleUpdateScheduleConfig({ motor2Angle: angle });
      setDeviceState((prev) => ({ ...prev, motor2Angle: angle, motor2TargetAngle: angle }));
      if (connectionState === 'connected') {
        await serialManager.sendCommand(`SET:M2_ANGLE=${angle}`, config.lineEnding);
      }
      setTimeout(() => {
        if (!deviceState.isRunning) {
          setDeviceState((prev) => ({ ...prev, motor2Angle: 0 }));
        }
      }, 1200);
      showToast(`Sudut Motor 2 diubah & diuji: ${angle}°`, 'success');
    }
  };

  // Custom command from Serial Monitor
  const handleSendCustom = async (msg: string) => {
    if (connectionState !== 'connected') {
      showToast('Hubungkan perangkat terlebih dahulu.', 'warn');
      return;
    }
    await serialManager.sendCommand(msg, config.lineEnding);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (runnerTimerRef.current) clearInterval(runnerTimerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-10">
      {/* Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 py-3.5 flex items-center justify-between">
        {/* Brand Zone */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-md shadow-cyan-950/50">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-base sm:text-lg font-bold tracking-tight text-white block leading-tight">
              Arduino Motor & Jeda Controller
            </span>
          </div>
        </div>

        {/* Action Buttons in Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCodeModalOpen(true)}
            className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Lihat Kode Arduino (.ino)"
          >
            <FileCode className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Kode Arduino</span>
          </button>

          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="h-9 w-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            title="Pengaturan Serial & Perintah"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-3.5 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">
        {/* Toast Notification */}
        {toastMessage && (
          <div
            className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-2xl text-xs sm:text-sm font-semibold flex items-center gap-2 border transition-all animate-in fade-in slide-in-from-top-2 duration-200 max-w-[90vw] ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50 shadow-emerald-950/50'
                : 'bg-amber-950/90 text-amber-200 border-amber-500/50 shadow-amber-950/50'
            }`}
          >
            {toastMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span className="truncate">{toastMessage.text}</span>
          </div>
        )}

        {/* 1. KETERANGAN STATUS KONEKSI (Connected Status Indicator + Safety Warning) */}
        <ConnectionCard
          connectionState={connectionState}
          connectionInfo={connectionInfo}
          isSimulated={isSimulated}
          baudRate={config.baudRate}
          isWebSerialSupported={serialManager.isWebSerialSupported()}
          rxActive={rxActive}
          txActive={txActive}
          onConnectReal={handleConnectReal}
          onToggleSimulated={handleToggleSimulated}
          onDisconnect={handleDisconnect}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
        />

        {/* 2. PANEL 3 TOMBOL (MOTOR 1, JEDA, MOTOR 2) + KOLOM DETIK + PILIHAN SIKLUS + TOMBOL TERAPKAN */}
        <ThreeButtonControl
          scheduleConfig={scheduleConfig}
          onUpdateScheduleConfig={handleUpdateScheduleConfig}
          currentPhase={deviceState.currentPhase}
          isRunning={deviceState.isRunning}
          phaseSecondsLeft={deviceState.phaseSecondsLeft}
          totalSecondsLeft={deviceState.totalSecondsLeft}
          connectionState={connectionState}
          onApply={handleApply}
          onStop={handleStop}
          onTestSingle={handleTestSingle}
        />

        {/* 3. SIMULASI RESPON PERANGKAT MOTOR (90° & 180° Visualizer + Terapkan Sudut) */}
        <ArduinoVisualizer
          deviceState={deviceState}
          txActive={txActive}
          rxActive={rxActive}
          isConnected={connectionState === 'connected'}
          onApplyManualAngle={handleApplyManualAngle}
        />

        {/* 4. SERIAL MONITOR & LOG TRANSMISI */}
        <SerialMonitor
          logs={logs}
          onSendCustom={handleSendCustom}
          onClear={() => setLogs([])}
          isConnected={connectionState === 'connected'}
        />

        {/* Quick Instructions & Pin Map */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-slate-200">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Alur Operasi Servo Motor 1, Jeda, dan Motor 2:</span>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11px] leading-relaxed">
            <li>
              Hubungkan kabel sinyal PWM: <strong className="text-cyan-300">Servo Motor 1 ke Pin D9</strong> dan <strong className="text-amber-300">Servo Motor 2 ke Pin D10</strong> pada Arduino.
            </li>
            <li>
              Masukkan durasi (detik) pada kolom di atas <strong className="text-cyan-300">MOTOR 1</strong>, <strong className="text-indigo-300">JEDA</strong> (wajib minimal 2 detik, contoh 8s), dan <strong className="text-amber-300">MOTOR 2</strong>.
            </li>
            <li>
              Pilih target sudut gerak servo: <strong className="text-cyan-300">90°</strong> atau <strong className="text-cyan-300">180°</strong> (gerakan otomatis bolak-balik 0° ➔ Sudut ➔ 0°).
            </li>
            <li>
              Tentukan mode siklus: <strong className="text-emerald-300">Alat Beroperasi Terus Menerus</strong> atau <strong className="text-cyan-300">Alat Beroperasi Dengan Waktu (Menit)</strong>.
            </li>
            <li>
              Tekan tombol <strong className="text-emerald-400">TERAPKAN</strong> untuk mulai menggerakkan kedua servo secara berurutan dengan jeda yang ditentukan.
            </li>
          </ol>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-8 text-center text-xs text-slate-600">
        <p>Arduino USB Android Servo Controller · Motor 1, Jeda & Motor 2</p>
      </footer>

      {/* Arduino Sketch (.ino) Modal */}
      <ArduinoCodeModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        config={config}
        scheduleConfig={scheduleConfig}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={config}
        onUpdateConfig={(updated) => setConfig((prev) => ({ ...prev, ...updated }))}
        onResetDefaults={() => setConfig(DEFAULT_CONFIG)}
      />
    </div>
  );
}
