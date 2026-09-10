<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { usePageAnimation } from '$lib/usePageAnimation';
	import {
		pendingTasks,
		deadlineColor,
		countColor,
		dueDateLabel
	} from '$lib/localTasks';
	import { completeTask, removeTask } from '$lib/googleTasksStore';
	import { currentLocale } from '$lib/languageStore';
	import gsap from 'gsap';
	import CircleClock from '$lib/components/CircleClock.svelte';
	import { physicsRotation, physicsClickCount, modeSwitchEnabled } from '$lib/physicsController';
	import { get } from 'svelte/store';
	import { EASE_OUT, EASE_IN } from '$lib/easings';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	const IS_PHYSICS = import.meta.env.VITE_IS_PHYSICS === 'true';
	const ITEM_DEG = 30;

	let tablePageEl: HTMLDivElement | undefined = $state();
	let tableContentEl: HTMLDivElement | undefined = $state();
	let taskCountEl: HTMLDivElement | undefined = $state();
	let prevItemRotation = get(physicsRotation);
	let itemRotAccum = 0;
	let prevClickCount = get(physicsClickCount);
	let drum = $state<HTMLDivElement | null>(null);
	let currentIndex = $state(0);
	let isAnimating = false;
	let isDragging = false;
	let activePointerId: number | null = null;
	let dragStartY = 0;
	let dragStartRotation = 0;
	let currentRotationX = 0;
	let didDrag = false;
	let pointerStartTaskId: string | null = null;

	// ── 横スワイプ状態 ──────────────────────────────────────────────────────
	let swipeStartX = 0;
	let swipeX = 0;
	let swipeTaskId: string | null = null;
	type SwipeMode = 'none' | 'h' | 'v';
	let swipeMode: SwipeMode = 'none';
	// ─────────────────────────────────────────────────────────────────────────
	let scrollProgress = $state(0);

	const CARD_ANGLE = 22;
	const CYLINDER_R = 260;
	const WHEEL_PX_PER_ITEM = 1000;
	const DRAG_ROTATION_FACTOR = 0.15;
	const DRAG_START_PX = 6;

	/**
	 * カルーセルの可視範囲。currentIndex から前後この枚数だけ DOM を生成する。
	 * 背面カードは backface-visibility:hidden で見えないため、地平線(約90°/CARD_ANGLE≈4枚)＋余裕で十分。
	 * これによりタスク数が多くても遷移時の DOM/SVG 生成・stagger アニメ対象が一定に保たれる。
	 */
	const VISIBLE_HALF = 6;

	/** 実インデックス i を保持したまま可視範囲だけ切り出したリスト */
	const visibleCards = $derived.by(() => {
		const tasks = $pendingTasks;
		const lo = Math.max(0, currentIndex - VISIBLE_HALF);
		const hi = Math.min(tasks.length - 1, currentIndex + VISIBLE_HALF);
		const out: { task: (typeof tasks)[number]; i: number }[] = [];
		for (let i = lo; i <= hi; i++) out.push({ task: tasks[i], i });
		return out;
	});

	function clampIndex(index: number) {
		const tasks = $pendingTasks;
		return Math.max(0, Math.min(index, tasks.length - 1));
	}

	function clampRotation(rotationX: number) {
		const maxRotation = clampIndex($pendingTasks.length - 1) * CARD_ANGLE;
		return Math.max(0, Math.min(rotationX, maxRotation));
	}

	function setRotation(rotationX: number) {
		if (!drum) return;
		currentRotationX = clampRotation(rotationX);
		currentIndex = clampIndex(Math.round(currentRotationX / CARD_ANGLE));
		gsap.set(drum, { rotationX: currentRotationX });
		updateScrollProgress();
	}

	function rotateTo(index: number) {
		if (isAnimating || !drum) return;
		isAnimating = true;
		const clampedIndex = clampIndex(index);
		currentIndex = clampedIndex;
		currentRotationX = clampedIndex * CARD_ANGLE;
		updateScrollProgress();
		gsap.to(drum, {
			rotationX: currentRotationX,
			duration: 0.3,
			ease: 'power3.out',
			onComplete: () => {
				isAnimating = false;
			}
		});
	}

	function updateScrollProgress() {
		const maxRotation = Math.max(0, ($pendingTasks.length - 1) * CARD_ANGLE);
		if (maxRotation <= 0) {
			scrollProgress = 0;
			return;
		}
		scrollProgress = Math.max(0, Math.min(currentRotationX / maxRotation, 1));
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const steps = Math.max(1, Math.round(Math.abs(e.deltaY) / WHEEL_PX_PER_ITEM));
		rotateTo(currentIndex + Math.sign(e.deltaY) * steps);
	}

	// ── スワイプビジュアル更新 ─────────────────────────────────────────────
	// gsap.set で管理することで、後続の gsap.to がリセットせず現在位置から動く
	function updateSwipeVisual(taskId: string, x: number) {
		const el = drum?.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
		if (!el) return;
		const cardInner = el.querySelector('.card-inner') as HTMLElement | null;
		const bgRight = el.querySelector('.swipe-bg-right') as HTMLElement | null;
		const bgLeft = el.querySelector('.swipe-bg-left') as HTMLElement | null;
		const iconRight = el.querySelector('.swipe-icon-right') as HTMLElement | null;
		const iconLeft = el.querySelector('.swipe-icon-left') as HTMLElement | null;

		gsap.set(cardInner, { x });

		const opacity = Math.min(Math.abs(x) / 60, 1);
		if (x >= 0) {
			gsap.set(bgRight, { opacity });
			gsap.set(bgLeft, { opacity: 0 });
			// アイコンは左端から中央に向かって移動（カードの 0.5 倍速）
			gsap.set(iconRight, { x: x * 0.5 });
		} else {
			gsap.set(bgLeft, { opacity });
			gsap.set(bgRight, { opacity: 0 });
			// アイコンは右端から中央に向かって移動
			gsap.set(iconLeft, { x: x * 0.5 });
		}
	}

	function snapBackSwipe(taskId: string) {
		const el = drum?.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
		if (!el) return;
		const cardInner = el.querySelector('.card-inner') as HTMLElement | null;
		const bgRight = el.querySelector('.swipe-bg-right') as HTMLElement | null;
		const bgLeft = el.querySelector('.swipe-bg-left') as HTMLElement | null;
		const iconRight = el.querySelector('.swipe-icon-right') as HTMLElement | null;
		const iconLeft = el.querySelector('.swipe-icon-left') as HTMLElement | null;
		gsap.to(cardInner, { x: 0, duration: 0.35, ease: 'power3.out' });
		gsap.to(bgRight, { opacity: 0, duration: 0.25, ease: 'power2.out' });
		gsap.to(bgLeft, { opacity: 0, duration: 0.25, ease: 'power2.out' });
		gsap.to(iconRight, { x: 0, duration: 0.35, ease: 'power3.out' });
		gsap.to(iconLeft, { x: 0, duration: 0.35, ease: 'power3.out' });
	}

	// currentX: 離した時点でのカード位置。そこからフェードアウト（戻らない）
	function animateSwipeOut(taskId: string, dir: 'right' | 'left', currentX: number) {
		const el = drum?.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
		if (!el) return;
		const cardInner = el.querySelector('.card-inner') as HTMLElement | null;
		const bgEl = el.querySelector(
			dir === 'right' ? '.swipe-bg-right' : '.swipe-bg-left'
		) as HTMLElement | null;
		const _iconEl = el.querySelector(
			dir === 'right' ? '.swipe-icon-right' : '.swipe-icon-left'
		) as HTMLElement | null;

		// GSAP に現在位置を伝えてからアニメーション（これがないとリセットされる）
		gsap.set(cardInner, { x: currentX });

		const tl = gsap.timeline({
			onComplete: () => {
				if (dir === 'right') completeTask(taskId);
				else removeTask(taskId);
			}
		});
		// その場でフェードアウト（アイコンは bgEl の子なので bgEl と一緒に消える）
		tl.to(cardInner, { opacity: 0, duration: 0.28, ease: 'power1.out' }, 0);
		tl.to(bgEl, { opacity: 0, duration: 0.32, ease: 'power1.out' }, 0);
	}
	// ─────────────────────────────────────────────────────────────────────────

	function onPointerDown(e: PointerEvent) {
		if (!drum) return;
		isDragging = true;
		activePointerId = e.pointerId;
		dragStartY = e.clientY;
		swipeStartX = e.clientX;
		dragStartRotation = currentRotationX;
		didDrag = false;
		swipeMode = 'none';
		swipeX = 0;
		swipeTaskId = null;
		pointerStartTaskId =
			e.target instanceof Element
				? (e.target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null)
				: null;
		isAnimating = false;
		gsap.killTweensOf(drum);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging || e.pointerId !== activePointerId) return;

		const dy = dragStartY - e.clientY;
		const dx = e.clientX - swipeStartX;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		if (swipeMode === 'none') {
			if (absDx < DRAG_START_PX && absDy < DRAG_START_PX) return;
			swipeMode = absDx > absDy ? 'h' : 'v';
			if (swipeMode === 'h') swipeTaskId = pointerStartTaskId;
		}

		if (swipeMode === 'h') {
			if (!swipeTaskId) return;
			swipeX = dx;
			updateSwipeVisual(swipeTaskId, swipeX);
		} else {
			didDrag = true;
			setRotation(dragStartRotation + dy * DRAG_ROTATION_FACTOR);
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging || e.pointerId !== activePointerId) return;

		const dy = dragStartY - e.clientY;
		isDragging = false;
		activePointerId = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

		if (swipeMode === 'h') {
			e.stopPropagation();
			const THRESHOLD = 80;
			if (swipeTaskId) {
				if (swipeX > THRESHOLD) animateSwipeOut(swipeTaskId, 'right', swipeX);
				else if (swipeX < -THRESHOLD) animateSwipeOut(swipeTaskId, 'left', swipeX);
				else snapBackSwipe(swipeTaskId);
			}
			swipeMode = 'none';
			swipeTaskId = null;
			swipeX = 0;
			didDrag = false;
			pointerStartTaskId = null;
			return;
		}

		if (!didDrag && pointerStartTaskId) {
			// タップ → タスク詳細へ（履歴に積まない）
			goto(resolve('/table/[id]', { id: pointerStartTaskId }), { replaceState: true });
		} else if (didDrag && dy < -80 && currentIndex === 0 && dragStartRotation === 0) {
			// 先頭にいるときの大きな下スワイプ → /table を閉じて前のページへ戻る
			e.stopPropagation();
			history.back();
		} else {
			// 通常ドラッグ → カルーセルをスナップ、レイアウト側の誤検知を防ぐ
			e.stopPropagation();
			rotateTo(currentIndex);
		}

		swipeMode = 'none';
		didDrag = false;
		pointerStartTaskId = null;
	}

	function onPointerCancel(e: PointerEvent) {
		if (!isDragging || e.pointerId !== activePointerId) return;
		if (swipeMode === 'h' && swipeTaskId) snapBackSwipe(swipeTaskId);
		isDragging = false;
		activePointerId = null;
		swipeMode = 'none';
		swipeTaskId = null;
		swipeX = 0;
		didDrag = false;
		pointerStartTaskId = null;
		rotateTo(currentIndex);
	}

	/** ノブ回転 → テーブルインデックス変換 (delta-based) */
	$effect(() => {
		if (!IS_PHYSICS || $modeSwitchEnabled) return;
		const tasks = $pendingTasks;
		if (tasks.length === 0) return;
		const rotation = $physicsRotation;
		untrack(() => {
			const delta = rotation - prevItemRotation;
			prevItemRotation = rotation;
			itemRotAccum += delta;
			const steps = Math.trunc(itemRotAccum / ITEM_DEG);
			if (steps === 0) return;
			itemRotAccum -= steps * ITEM_DEG;
			const newIndex = clampIndex(currentIndex + steps);
			if (newIndex !== currentIndex) rotateTo(newIndex);
		});
	});

	/** ボタンクリック → 選択中アイテムに遷移 */
	$effect(() => {
		const count = $physicsClickCount;
		if (!IS_PHYSICS || $modeSwitchEnabled) {
			prevClickCount = count;
			return;
		}
		if (count === prevClickCount) return;
		prevClickCount = count;
		const tasks = $pendingTasks;
		const task = tasks[currentIndex];
		if (task) goto(resolve('/table/[id]', { id: task.id }), { replaceState: true });
	});

	/** スクロール位置に応じてタスクカウントをフェード */
	$effect(() => {
		if (!taskCountEl) return;
		if (currentIndex > 0) {
			gsap.to(taskCountEl, { opacity: 0, duration: 0.1, ease: EASE_IN });
		} else {
			gsap.to(taskCountEl, { opacity: 1, duration: 0.3, ease: EASE_OUT });
		}
	});

	usePageAnimation({
		animateIn(_from) {
			// 遷移元に関わらず同じ入場アニメーション
			if (!tableContentEl || !taskCountEl) return;
			gsap.from(taskCountEl, { y: 200, scale: 0.9, duration: 0.6, ease: EASE_OUT });
			gsap.from(tableContentEl, { scale: 1.06, duration: 0.35, ease: EASE_OUT });
			const cardEls = tableContentEl.querySelectorAll('.card-inner');
			if (cardEls.length) {
				// マウントフレームでは opacity:0 にするだけ（軽い書き込み）。
				// stagger tween の生成はページ切り替え直後の重いフレームを避けて次フレームへ。
				gsap.set(cardEls, { opacity: 0, y: 10 });
				requestAnimationFrame(() => {
					gsap.to(cardEls, {
						opacity: 1,
						y: 0,
						duration: 0.3,
						ease: EASE_OUT,
						stagger: { amount: 0.12, from: 'center' },
						clearProps: 'opacity,transform'
					});
				});
			}
		},

		animateOut(_to, done) {
			// done() を 0.35s で先行発火させ、ナビゲーション処理をアニメーション末尾と重ねてフリーズを隠す
			const tl = gsap.timeline();
			if (taskCountEl) tl.to(taskCountEl, { y: 200, scale: 0.9, duration: 0.4, ease: EASE_IN });
			if (tableContentEl) {
				const cardEls = tableContentEl.querySelectorAll('.card-inner');
				if (cardEls.length) {
					tl.to(cardEls, { opacity: 0, y: -10, duration: 0.4, ease: EASE_IN, stagger: { amount: 0.1, from: 'center' } }, 0);
				}
				tl.to(tableContentEl, { scale: 1.06, duration: 0.4, ease: EASE_IN }, 0);
			}
			tl.call(done, [], 0.28);
		}
	});

	onMount(() => {
		if (drum) {
			currentRotationX = 0;
			gsap.set(drum, { rotationX: 0 });
			updateScrollProgress();
		}
	});
</script>

<div
	class="rel w:full h:full flex flex:column ai:center jc:center bg:base-6 overflow:hidden"
	bind:this={tablePageEl}
	tabindex="0"
	role="button"
	style="touch-action: none"
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerCancel}
	onkeydown={(e) => e.preventDefault()}
>
	<CircleClock />

	<div class="abs inset:0 flex ai:center jc:center" bind:this={tableContentEl}>
		<div class="abs z:999 w:684px square top:50% left:50% translate(-50%,-50%) pointer-events:none">
			<div class="rel w:full h:full">
				<svg
					class="abs z:0 top:50% left:50% translate(-50%,-50%)"
					width="684"
					height="684"
					viewBox="0 0 684 684"
				>
					<path
						class="stroke:base-4"
						d="M 642 266 A 300 300 0 0 1 642 433"
						fill="none"
						stroke-linecap="round"
						stroke-width="12"
					/>
				</svg>
				<svg
					class="abs z:1 top:50% left:50% translate(-50%,-50%)"
					width="684"
					height="684"
					viewBox="0 0 684 684"
				>
					<path
						class="stroke:base-1 ~stroke-dashoffset|200ms"
						d="M 642 266 A 300 300 0 0 1 642 433"
						fill="none"
						stroke-linecap="round"
						stroke-width="12"
						stroke-dasharray="25 148"
						stroke-dashoffset={-scrollProgress * 148}
					/>
				</svg>
			</div>
		</div>

		<div
			bind:this={taskCountEl}
			class="abs top:60px left:50% translateX(-50%)|scale(0.76) flex flex:column ai:center jc:center"
		>
			<span
				class="f:10rem font-weight:700 line-h:1 fg:{countColor($pendingTasks.length)} ~color|0.5s"
			>
				{$pendingTasks.length}
			</span>
			<span class="f:2rem font-weight:700 fg:#9D9D9D ls:0.1em">Tasks</span>
		</div>

		<div
			class="perspective w:300px h:300px flex ai:center jc:center"
			style="transform-style:preserve-3d"
		>
			<div bind:this={drum} class="w:stretch h:90px rel transform-style:preserve-3d">
				{#each visibleCards as { task, i } (task.id)}
					{@const angle = i * CARD_ANGLE}
					{@const active = i === currentIndex}
					<div
						class="backface abs top:0 left:0 w:stretch h:stretch pointer-events:auto"
						data-task-id={task.id}
						role="button"
						tabindex={active ? 0 : -1}
						style="transform: rotateX({-angle}deg) translateZ({CYLINDER_R}px); overflow:hidden; border-radius:12px;"
						onkeydown={(e) => e.preventDefault()}
					>
						<!-- 右スワイプ(完了)の背景：アイコンは左端から中央へ -->
						<div class="swipe-bg-right abs inset:0 flex ai:center">
							<div
								class="swipe-icon-right"
								style="margin-left:18px; margin-right:auto; flex-shrink:0;"
							>
								<svg width="34" height="34" viewBox="0 0 100 100" fill="none">
									<path
										d="M26 51.0769L41.3928 64L73 36"
										stroke="#F7F7F7"
										stroke-width="7"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</div>
						</div>
						<!-- 左スワイプ(削除)の背景：アイコンは右端から中央へ -->
						<div class="swipe-bg-left abs inset:0 flex ai:center">
							<div
								class="swipe-icon-left"
								style="margin-left:auto; margin-right:18px; flex-shrink:0;"
							>
								<svg
									width="42"
									height="42"
									viewBox="0 0 100 100"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M40.6957 38.1978L38.6252 30.4704L52.1481 26.8469L54.2187 34.5743M40.6957 38.1978L30.0706 41.0448M40.6957 38.1978L54.2187 34.5743M54.2187 34.5743L64.8439 31.7273"
										stroke="#DF4242"
										stroke-width="6"
									/>
									<path
										d="M33 49H38M38 49L40 73H60L62 49M38 49H62M62 49H67"
										stroke="#DF4242"
										stroke-width="6"
									/>
								</svg>
							</div>
						</div>
						<!-- カード本体（横スワイプで平行移動） -->
						<div
							class="card-inner w:full h:full bg:#1e1e1e r:12px p:0|20px flex flex:column ai:start jc:center gap:7px box-sizing:border-box"
							class:active
						>
							<span
								class="card-title f:1rem line-h:1 fg:#cfcfcf font-weight:500 white-space:nowrap overflow:hidden text-overflow:ellipsis"
								class:active>{task.title}</span
							>
							<div class="flex ai:center gap:5px flex-shrink:0">
								<span class="w:6px h:6px r:full" style="background:{deadlineColor(task.dueDate)}"
								></span>
								<span class="f:0.7rem font-weight:500" style="color:{deadlineColor(task.dueDate)}"
									>{dueDateLabel(task.dueDate, $currentLocale)}</span
								>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.perspective {
		perspective: 600px;
	}
	.backface {
		backface-visibility: hidden;
	}

	.card-inner {
		transition:
			background 0.2s,
			border-color 0.2s;
	}

	.card-inner.active {
		background: #252525;
		border-color: #3a3a3a;
	}

	.card-title.active {
		color: #f0f0f0;
		font-weight: 600;
	}

	.swipe-bg-right {
		opacity: 0;
		border-radius: 12px;
	}

	.swipe-bg-left {
		opacity: 0;
		border-radius: 12px;
	}
</style>
