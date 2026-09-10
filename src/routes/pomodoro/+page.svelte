<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { pendingTasks } from '$lib/localTasks';
	import { currentLocale } from '$lib/languageStore';
	import { t } from '$lib/i18n';
	import {
		pomodoroPhase,
		pomodoroLoop,
		pomodoroTimeDisplay,
		isPaused,
		startTimer,
		stopTimer,
		togglePause,
		skipInterval
	} from '$lib/pomodoroStore';
	import { physicsRotation, physicsClickCount } from '$lib/physicsController';
	import CircleClock from '$lib/components/CircleClock.svelte';
	import TaskCount from '$lib/components/TaskCount.svelte';
	import gsap from 'gsap';
	import { usePageAnimation } from '$lib/usePageAnimation';
	import { EASE_OUT, EASE_IN } from '$lib/easings';

	const IS_PHYSICS = import.meta.env.VITE_IS_PHYSICS === 'true';
	const STEP_DEG = 5;

	let workMinutes = $state(25);
	let restMinutes = $state(5);
	let loopCount = $state(10);
	let countMode = $state<'work' | 'rest' | 'loop'>('work');

	// delta ベース：毎フレームの差分だけ見るので上限/下限でのデッドゾーンが生じない
	let prevRotation = get(physicsRotation);
	let rotAccum = 0; // サブステップ累積
	let prevClickCount = get(physicsClickCount);

	function resetBases() {
		prevRotation = get(physicsRotation);
		rotAccum = 0;
	}

	// Physical button click cycles through countMode
	$effect(() => {
		const count = $physicsClickCount;
		if (!IS_PHYSICS) { prevClickCount = count; return; }
		if (count === prevClickCount) return;
		prevClickCount = count;
		untrack(() => {
			countMode = countMode === 'work' ? 'rest' : countMode === 'rest' ? 'loop' : 'work';
			resetBases();
		});
	});

	// Knob rotation adjusts the selected field (delta-based)
	$effect(() => {
		if (!IS_PHYSICS) return;
		const rotation = $physicsRotation;
		untrack(() => {
			const delta = rotation - prevRotation;
			prevRotation = rotation;
			rotAccum += delta;
			const steps = Math.trunc(rotAccum / STEP_DEG);
			if (steps === 0) return;
			rotAccum -= steps * STEP_DEG;
			if (countMode === 'work') {
				workMinutes = Math.max(1, Math.min(99, workMinutes + steps));
			} else if (countMode === 'rest') {
				restMinutes = Math.max(1, Math.min(30, restMinutes + steps));
			} else {
				loopCount = Math.max(1, Math.min(99, loopCount + steps));
			}
		});
	});

	let pageEl: HTMLDivElement | undefined = $state();
	let clockEl: HTMLDivElement | undefined = $state();
	let circleClockEl: HTMLDivElement | undefined = $state();
	let taskCountEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		resetBases();
	});

	usePageAnimation({
		animateIn(from) {
			const taskCountNode = taskCountEl?.firstElementChild as HTMLElement | null;
			const circleClockNode = circleClockEl?.firstElementChild as HTMLElement | null;
			if (from === '/table' && pageEl && clockEl) {
				gsap.from(taskCountNode, { y: -400, duration: 0.3, ease: EASE_OUT });
				gsap.from(clockEl, { scale: 0.9, duration: 0.3, ease: EASE_OUT });
				// width ではなく scale で拡縮（毎フレームの reflow を避ける）
				gsap.from(pageEl, { scale: 720 / pageEl.offsetWidth, duration: 0.35, ease: EASE_OUT });
			} else if (from === '/clock') {
				const tl = gsap.timeline();
				tl.from(taskCountNode, { transform: 'translate(-50%,-130px)', duration: 0.4, ease: EASE_OUT }, 0);
				tl.from(circleClockNode, { opacity: 0, duration: 0.4, ease: EASE_OUT }, 0);
				if (pageEl) tl.from(pageEl, { transform: 'translate(-100%,-50%)', duration: 0.4, ease: EASE_OUT }, 0);
			} else if (from === '/stack') {
				if (pageEl) gsap.from(pageEl, { transform: 'translate(0,-50%)', duration: 0.4, ease: EASE_OUT });
			}
		},

		animateOut(to, done) {
			const taskCountNode = taskCountEl?.firstElementChild as HTMLElement | null;
			const circleClockNode = circleClockEl?.firstElementChild as HTMLElement | null;
			if (to === '/table') {
				// done() を 0.3s で先行発火させ、ナビゲーション処理をアニメーション末尾と重ねてフリーズを隠す
				const tl = gsap.timeline();
				tl.to(taskCountNode, { y: -400, duration: 0.3, ease: EASE_IN }, 0);
				tl.to(circleClockNode, { opacity: 0, duration: 0.3, ease: EASE_IN }, 0);
				if (clockEl) tl.to(clockEl, { scale: 0.9, duration: 0.3, ease: EASE_IN }, 0);
				// width ではなく scale で拡縮（毎フレームの reflow を避ける）
				if (pageEl) tl.to(pageEl, { scale: 760 / pageEl.offsetWidth, duration: 0.3, ease: EASE_IN }, 0);
				tl.call(done, [], 0.22);
				return;
			}
			const tl = gsap.timeline({ onComplete: done });
			if (to === '/clock') {
				if (pageEl) tl.to(pageEl, { transform: 'translate(-100%,-50%)', opacity: 0, duration: 0.2, ease: EASE_IN }, 0);
				tl.to(taskCountNode, { transform: 'translate(-50%,-100px) scale(1.2)', duration: 0.2, ease: EASE_IN }, 0);
			} else {
				// /stack, /settings
				if (pageEl) tl.to(pageEl, { transform: 'translate(0%,-50%)', opacity: 0, duration: 0.2, ease: EASE_IN }, 0);
			}
		}
	});

	const ui = $derived(t($currentLocale));
	const modeLabel = $derived(
		countMode === 'work' ? ui.workTime : countMode === 'rest' ? ui.restTime : ui.loopCount
	);
</script>

<div class="rel w:full h:full r:full bg:base-5 overflow:hidden" aria-label="pomodoro timer">
	<div bind:this={circleClockEl}>
		<CircleClock isPomodoro={true} />
	</div>

	{#if $pomodoroPhase === 'idle'}
		<div
			bind:this={pageEl}
			class="abs top:50% left:50% translate(-50%,-50%) w:544px square r:999px bg:base-6 inset:0 flex flex:column ai:center jc:center gap:20px"
		>
			<div bind:this={clockEl} class="flex rel flex:column ai:center jc:center">
				<div class="flex flex:row gap:20px">
					<button
						aria-label="btn"
						class="arrow-btn"
						onclick={() => {
							if (countMode === 'work') {
								workMinutes = Math.max(workMinutes - 1, 1);
							} else if (countMode === 'rest') {
								restMinutes = Math.max(restMinutes - 1, 1);
							} else {
								loopCount = Math.max(loopCount - 1, 1);
							}
							resetBases();
						}}
					>
						<svg width="20" height="12" viewBox="0 0 20 12"
							><path
								d="M1 11L10 2L19 11"
								class="stroke:base-2"
								stroke-width="2.5"
								stroke-linecap="round"
							/></svg
						>
					</button>

					<div class="flex flex:row gap:12px jc:center ai:end">
						<div
							class="flex flex:column ai:center jc:end"
							role="button"
							tabindex="0"
							onclick={() => { countMode = 'work'; resetBases(); }}
							onkeydown={() => {}}
						>
							<span
								class="font-weight:600 fg:{countMode === 'work' ? 'base-1' : 'base-3'} line-h:1 ls:-0.02em ~font-size|150ms|ease-out"
								style="font-size: {countMode === 'work' ? '5.5rem' : '3rem'}"
							>
								{workMinutes}
							</span>
						</div>

						<div
							class="flex ai:center jc:start pb:8px"
							role="button"
							tabindex="0"
							onclick={() => { countMode = 'rest'; resetBases(); }}
							onkeydown={() => {}}
						>
							<span
								class="font-weight:600 fg:{countMode === 'rest' ? 'base-1' : 'base-3'} line-h:1 ~font-size|150ms|ease-out"
								style="font-size: {countMode === 'rest' ? '5.5rem' : '3rem'}"
							>
								{restMinutes}
							</span>
						</div>

						<div
							class="flex ai:center jc:start pb:8px"
							role="button"
							tabindex="0"
							onclick={() => { countMode = 'loop'; resetBases(); }}
							onkeydown={() => {}}
						>
							<span
								class="font-weight:600 fg:{countMode === 'loop' ? 'base-1' : 'base-3'} line-h:1 ~font-size|150ms|ease-out"
								style="font-size: {countMode === 'loop' ? '5.5rem' : '3rem'}"
							>
								{loopCount}
							</span>
						</div>
					</div>

					<button
						aria-label="btn"
						class="arrow-btn"
						onclick={() => {
							if (countMode === 'work') {
								workMinutes = Math.min(workMinutes + 1, 99);
							} else if (countMode === 'rest') {
								restMinutes = Math.min(restMinutes + 1, 30);
							} else {
								loopCount = Math.min(loopCount + 1, 99);
							}
							resetBases();
						}}
					>
						<svg width="20" height="12" viewBox="0 0 20 12"
							><path
								d="M1 1L10 10L19 1"
								class="stroke:base-2"
								stroke-width="2.5"
								stroke-linecap="round"
							/></svg
						>
					</button>
				</div>

				<span class="f:1.6em font-weight:700 fg:base-2 mt:6px white-space:nowrap">
					{modeLabel}
				</span>
			</div>

			<button
				aria-label="btn"
				class="w:255px h:87px bg:base-5 r:99px cursor:pointer flex ai:center jc:center"
				onclick={() => startTimer(workMinutes, restMinutes, loopCount)}
			>
				<svg width="36" height="36" viewBox="0 0 36 36">
					<polygon points="10,5 31,18 10,31" class="fill:base-1" />
				</svg>
			</button>
		</div>
	{:else}
		<div
			bind:this={pageEl}
			class="abs top:50% left:50% translate(-50%,-50%) w:422px square r:999px pb:50px bg:base-6 inset:0 flex flex:column ai:center jc:center gap:25px"
		>
			<span class="flex ai:baseline gap:2px">
				<span class="f:2rem font-weight:600 fg:base-1">{$pomodoroLoop.current}</span>
				<span class="f:1.4rem font-weight:500 fg:base-2">/{$pomodoroLoop.total}</span>
			</span>

			<div class="flex flex:column ai:center jc:center gap:0px">
				<span
					class="f:2.2rem font-weight:600 font-family:Capitana,'reddit-sans',sans-serif color:{$pomodoroPhase ===
					'work'
						? 'orange-1'
						: 'blue-1'}"
				>
					{$pomodoroPhase === 'work' ? ui.work : ui.breakPhase}
				</span>
				<div
					class="f:5rem font-weight:600 fg:base-1 ls:0.02em font-family:'reddit-sans',sans-serif"
				>
					{$pomodoroTimeDisplay}
				</div>
			</div>

			<div class="grid h:87px grid-template-columns:87px|120px|87px gap:14px ai:center jc:center">
				<button
					aria-label="btn"
					class="w:full h:full bg:base-5 r:999px flex ai:center jc:center"
					onclick={stopTimer}
				>
					<svg width="28" height="28" viewBox="0 0 28 28">
						<rect x="4" y="4" width="20" height="20" rx="2" class="fill:base-1" />
					</svg>
				</button>

				<button
					class="w:full h:full bg:base-5 r:999px cursor:pointer flex ai:center jc:center"
					onclick={togglePause}
				>
					{#if $isPaused}
						<svg width="28" height="28" viewBox="0 0 28 28">
							<polygon points="7,3 25,14 7,25" class="fill:base-1" />
						</svg>
					{:else}
						<svg width="28" height="28" viewBox="0 0 28 28">
							<rect x="5" y="4" width="7" height="20" rx="2" class="fill:base-1" />
							<rect x="16" y="4" width="7" height="20" rx="2" class="fill:base-1" />
						</svg>
					{/if}
				</button>

				<button
					aria-label="btn"
					class="w:full h:full bg:base-5 r:999px flex ai:center jc:center"
					onclick={skipInterval}
				>
					<svg width="32" height="28" viewBox="0 0 32 28">
						<polygon points="4,3 21,14 4,25" class="fill:base-1" />
						<rect x="24" y="3" width="5" height="22" rx="2" class="fill:base-1" />
					</svg>
				</button>
			</div>
		</div>
	{/if}

	<div bind:this={taskCountEl}>
		<TaskCount length={$pendingTasks.length} />
	</div>
</div>
