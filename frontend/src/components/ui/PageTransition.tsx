import { useState, useEffect, useRef, useCallback } from 'react';

interface PageTransitionProps {
  transitionKey: string;
  children: React.ReactNode;
  className?: string;
}

export default function PageTransition({ transitionKey, children, className = '' }: PageTransitionProps) {
  const [rendered, setRendered] = useState(children);
  const [animClass, setAnimClass] = useState('page-enter');
  const prevKey = useRef(transitionKey);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleTransition = useCallback(() => {
    // Phase 1: exit current
    setAnimClass('page-exit');

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Phase 2: swap content + enter
      setRendered(children);
      setAnimClass('page-enter');
    }, 200);
  }, [children]);

  useEffect(() => {
    if (transitionKey !== prevKey.current) {
      prevKey.current = transitionKey;
      handleTransition();
    } else {
      // Same key, just update children silently
      setRendered(children);
    }
  }, [transitionKey, children, handleTransition]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className={`${animClass} ${className}`}>
      {rendered}
    </div>
  );
}
